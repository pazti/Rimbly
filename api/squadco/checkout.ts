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
  const secretKey = process.env.SQUADCO_SECRET_KEY;
  const appUrl = process.env.APP_URL;
  const configuredMode = process.env.SQUADCO_MODE?.trim().toLowerCase();
  const mode =
    configuredMode === "production" || configuredMode === "prod" || configuredMode === "live"
      ? "production"
      : configuredMode === "sandbox" ||
          configuredMode === "test" ||
          configuredMode === "development" ||
          configuredMode === "dev"
        ? "sandbox"
        : process.env.VERCEL_ENV === "production"
          ? "production"
          : "sandbox";
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !appUrl) {
    return respond(response, 503, {
      error: "Billing is not configured yet. Ask an administrator to finish the server setup.",
    });
  }
  if (!secretKey) {
    return respond(response, 503, {
      error: "SquadCo checkout is not enabled yet. The payment keys have not been added.",
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
  const apiBase =
    mode === "production" ? "https://api-d.squadco.com" : "https://sandbox-api-d.squadco.com";
  let gatewayResponse: Response;
  try {
    gatewayResponse = await fetch(`${apiBase}/transaction/initiate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: authData.user.email,
        amount: Number(amountKobo),
        currency: "NGN",
        initiate_type: "inline",
        transaction_ref: transactionRef,
        customer_name:
          typeof authData.user.user_metadata.full_name === "string"
            ? authData.user.user_metadata.full_name
            : undefined,
        callback_url: checkoutUrl.toString(),
        payment_channels: ["card", "bank", "ussd", "transfer"],
        metadata: { product: "rimbly_pro", plan_id: plan.id, user_id: authData.user.id },
        pass_charge: false,
      }),
    });
  } catch (gatewayError) {
    const message = gatewayError instanceof Error ? gatewayError.message : "Network error";
    console.error("SquadCo checkout request failed:", message);
    const { error: updateError } = await serviceClient
      .from("rimbly_billing_payments")
      .update({ status: "failed" })
      .eq("transaction_ref", transactionRef);
    if (updateError) {
      console.error("Could not mark failed SquadCo checkout:", updateError.message);
    }
    return respond(response, 502, { error: "Could not connect to SquadCo. Please try again." });
  }

  const responseBody = (await gatewayResponse.json().catch(() => null)) as {
    data?: { checkout_url?: unknown };
    message?: string;
  } | null;
  let hostedUrl: URL | null = null;
  if (typeof responseBody?.data?.checkout_url === "string") {
    try {
      hostedUrl = new URL(responseBody.data.checkout_url);
    } catch {
      hostedUrl = null;
    }
  }
  if (
    !gatewayResponse.ok ||
    !hostedUrl ||
    hostedUrl.protocol !== "https:" ||
    !hostedUrl.hostname.endsWith(".squadco.com")
  ) {
    console.error(
      "SquadCo rejected checkout initialization:",
      responseBody?.message ?? "Invalid response",
    );
    const { error: updateError } = await serviceClient
      .from("rimbly_billing_payments")
      .update({ status: "failed" })
      .eq("transaction_ref", transactionRef);
    if (updateError) {
      console.error("Could not mark rejected SquadCo checkout:", updateError.message);
    }
    return respond(response, 502, {
      error: "SquadCo could not start this payment. Please try again.",
    });
  }

  return respond(response, 200, { checkoutUrl: hostedUrl.toString(), transactionRef });
}
