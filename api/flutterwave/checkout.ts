import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

type CheckoutRequest = IncomingMessage & {
  body?: unknown;
};

function respond(response: ServerResponse, status: number, payload: Record<string, unknown>) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

export default async function handler(request: CheckoutRequest, response: ServerResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return respond(response, 405, { error: "Method not allowed." });
  }

  const authorization = request.headers.authorization;
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return respond(response, 401, { error: "Sign in to start checkout." });

  const body =
    request.body && typeof request.body === "object"
      ? (request.body as Record<string, unknown>)
      : null;
  const planId = typeof body?.planId === "string" ? body.planId : "";
  const plans: Record<string, { id: string; priceKobo: number }> = {
    weekly: { id: "weekly", priceKobo: 50_000 },
    monthly: { id: "monthly", priceKobo: 250_000 },
    semester: { id: "semester", priceKobo: 800_000 },
  };
  const plan = plans[planId];
  if (!plan) return respond(response, 400, { error: "Choose a valid Rimbly Pro plan." });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secretKey = process.env.FLW_SECRET_KEY;
  const appUrl = process.env.APP_URL;
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !appUrl) {
    return respond(response, 503, {
      error: "Billing is not configured yet. Ask an administrator to finish the server setup.",
    });
  }
  if (!secretKey) {
    return respond(response, 503, {
      error: "Flutterwave checkout is not enabled yet. The payment keys have not been added.",
    });
  }
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(appUrl);
  } catch {
    return respond(response, 500, { error: "APP_URL must be a valid absolute URL." });
  }
  if (
    callbackUrl.protocol !== "https:" &&
    !(callbackUrl.protocol === "http:" && callbackUrl.hostname === "localhost")
  ) {
    return respond(response, 500, { error: "APP_URL must use HTTPS." });
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
  if (authError || !authData.user) {
    return respond(response, 401, { error: "Your session is invalid. Sign in again." });
  }
  if (!authData.user.email) {
    return respond(response, 400, {
      error: "Add an email address to your account before checkout.",
    });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const transactionRef = `rimbly_${randomUUID().replace(/-/g, "")}`;
  const { data: amountKobo, error: checkoutError } = await serviceClient.rpc(
    "create_rimbly_pro_checkout",
    {
      p_user_id: authData.user.id,
      p_plan_id: plan.id,
      p_transaction_ref: transactionRef,
    },
  );
  if (checkoutError?.message.includes("RIMBLY_CHECKOUT_PENDING")) {
    return respond(response, 409, {
      error:
        "You already have a recent checkout in progress. Complete it or try again in 30 minutes.",
    });
  }
  if (checkoutError) {
    console.error("Could not create Rimbly Pro checkout:", checkoutError.message);
    return respond(response, 500, { error: "Could not start checkout. Please try again." });
  }
  if (!Number.isSafeInteger(amountKobo) || Number(amountKobo) !== plan.priceKobo) {
    console.error("Rimbly Pro price configuration differs between the app and database.");
    const { error: updateError } = await serviceClient
      .from("rimbly_billing_payments")
      .update({ status: "failed" })
      .eq("transaction_ref", transactionRef);
    if (updateError) {
      console.error("Could not close the mismatched Rimbly Pro checkout:", updateError.message);
    }
    return respond(response, 500, { error: "This plan is temporarily unavailable." });
  }

  const checkoutUrl = new URL("/?route=subscription", callbackUrl);
  checkoutUrl.searchParams.set("payment", transactionRef);
  const customerName =
    typeof authData.user.user_metadata.full_name === "string"
      ? authData.user.user_metadata.full_name
      : undefined;
  let gatewayResponse: Response;
  try {
    gatewayResponse = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: transactionRef,
        amount: String(Number(amountKobo) / 100),
        currency: "NGN",
        redirect_url: checkoutUrl.toString(),
        customer: {
          email: authData.user.email,
          ...(customerName ? { name: customerName } : {}),
        },
        customizations: {
          title: "Rimbly Pro",
          description: `${plan.id} Rimbly Pro plan`,
        },
        meta: { product: "rimbly_pro", plan_id: plan.id, user_id: authData.user.id },
      }),
    });
  } catch (gatewayError) {
    const message = gatewayError instanceof Error ? gatewayError.message : "Network error";
    console.error("Flutterwave checkout request failed:", message);
    const { error: updateError } = await serviceClient
      .from("rimbly_billing_payments")
      .update({ status: "failed" })
      .eq("transaction_ref", transactionRef);
    if (updateError) {
      console.error("Could not mark failed Flutterwave checkout:", updateError.message);
    }
    return respond(response, 502, {
      error: "Could not connect to Flutterwave. Please try again.",
    });
  }

  const responseBody = (await gatewayResponse.json().catch(() => null)) as {
    status?: unknown;
    data?: { link?: unknown };
    message?: string;
  } | null;
  let hostedUrl: URL | null = null;
  if (typeof responseBody?.data?.link === "string") {
    try {
      hostedUrl = new URL(responseBody.data.link);
    } catch {
      hostedUrl = null;
    }
  }
  if (
    !gatewayResponse.ok ||
    responseBody?.status !== "success" ||
    !hostedUrl ||
    hostedUrl.protocol !== "https:" ||
    hostedUrl.hostname !== "checkout.flutterwave.com"
  ) {
    console.error(
      "Flutterwave rejected checkout initialization:",
      responseBody?.message ?? "Invalid response",
    );
    const { error: updateError } = await serviceClient
      .from("rimbly_billing_payments")
      .update({ status: "failed" })
      .eq("transaction_ref", transactionRef);
    if (updateError) {
      console.error("Could not mark rejected Flutterwave checkout:", updateError.message);
    }
    return respond(response, 502, {
      error: "Flutterwave could not start this payment. Please try again.",
    });
  }

  return respond(response, 200, { checkoutUrl: hostedUrl.toString(), transactionRef });
}
