import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";

type WebhookRequest = IncomingMessage;

export const config = {
  api: { bodyParser: false },
};

function respond(response: ServerResponse, status: number, message: string) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ message }));
}

async function readRawBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 256 * 1024) throw new Error("Webhook body exceeds 256 KB.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function validSignature(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature || !/^[a-f\d]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function transactionReference(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const nested = [record.Body, record.body, record.data].find(
    (value) => value && typeof value === "object",
  ) as Record<string, unknown> | undefined;
  const value =
    record.transaction_ref ??
    record.transaction_reference ??
    record.TransactionRef ??
    nested?.transaction_ref;
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : null;
}

export default async function handler(request: WebhookRequest, response: ServerResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return respond(response, 405, "Method not allowed.");
  }

  const secretKey = process.env.SQUADCO_SECRET_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const mode = process.env.SQUADCO_MODE || "sandbox";
  if (!secretKey || !supabaseUrl || !serviceRoleKey) {
    console.error("SquadCo webhook is not configured.");
    return respond(response, 503, "Webhook is not configured.");
  }
  if (mode !== "sandbox" && mode !== "production") {
    console.error("SQUADCO_MODE must be sandbox or production.");
    return respond(response, 500, "Webhook configuration is invalid.");
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(request);
  } catch (readError) {
    const message = readError instanceof Error ? readError.message : "Could not read webhook body.";
    return respond(response, 413, message);
  }

  const signature =
    request.headers["x-squad-encrypted-body"] ?? request.headers["x-squad-signature"];
  const signatureValue = Array.isArray(signature) ? signature[0] : signature;
  if (!validSignature(rawBody, signatureValue, secretKey)) {
    return respond(response, 401, "Invalid SquadCo signature.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return respond(response, 400, "Invalid webhook JSON.");
  }
  const transactionRef = transactionReference(payload);
  if (!transactionRef)
    return respond(response, 400, "Transaction reference is missing or invalid.");

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: payment, error: paymentError } = await serviceClient
    .from("rimbly_billing_payments")
    .select("status")
    .eq("transaction_ref", transactionRef)
    .maybeSingle();
  if (paymentError) {
    console.error("Could not find Rimbly Pro payment:", paymentError.message);
    return respond(response, 500, "Could not process this payment.");
  }
  if (!payment) return respond(response, 200, "Payment reference is not for Rimbly Pro.");
  if (payment.status === "paid") return respond(response, 200, "Payment already processed.");

  const apiBase =
    mode === "production" ? "https://api-d.squadco.com" : "https://sandbox-api-d.squadco.com";
  let verificationResponse: Response;
  try {
    verificationResponse = await fetch(
      `${apiBase}/transaction/verify/${encodeURIComponent(transactionRef)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
  } catch (verifyError) {
    const message = verifyError instanceof Error ? verifyError.message : "Network error";
    console.error("SquadCo transaction verification failed:", message);
    return respond(response, 502, "Could not verify the payment with SquadCo.");
  }

  const verification = (await verificationResponse.json().catch(() => null)) as {
    data?: Record<string, unknown>;
  } | null;
  if (!verificationResponse.ok || !verification?.data) {
    console.error("SquadCo transaction verification returned an invalid response.");
    return respond(response, 502, "Could not verify the payment with SquadCo.");
  }

  const verified = verification.data;
  if (verified.transaction_ref !== transactionRef) {
    return respond(response, 400, "Verified transaction reference does not match.");
  }
  const status =
    typeof verified.transaction_status === "string"
      ? verified.transaction_status.toLowerCase()
      : "";
  if (status !== "success") {
    if (["failed", "abandoned", "expired"].includes(status)) {
      const { error: updateError } = await serviceClient
        .from("rimbly_billing_payments")
        .update({ status: "failed" })
        .eq("transaction_ref", transactionRef)
        .eq("status", "pending");
      if (updateError) {
        console.error("Could not record failed SquadCo payment:", updateError.message);
        return respond(response, 500, "Could not update payment status.");
      }
      return respond(response, 200, "Payment was not successful.");
    }
    if (status === "pending") return respond(response, 503, "Payment is still pending.");
    return respond(response, 502, "SquadCo returned an unknown transaction status.");
  }

  const amountKobo = Number(verified.transaction_amount);
  const currency =
    typeof verified.transaction_currency_id === "string"
      ? verified.transaction_currency_id
      : typeof verified.transaction_currency === "string"
        ? verified.transaction_currency
        : typeof verified.currency === "string"
          ? verified.currency
          : "";
  if (!Number.isSafeInteger(amountKobo) || currency.toUpperCase() !== "NGN") {
    return respond(response, 400, "Verified payment amount or currency is invalid.");
  }

  const { error: activationError } = await serviceClient.rpc("activate_rimbly_pro_payment", {
    p_transaction_ref: transactionRef,
    p_amount_kobo: amountKobo,
    p_currency: currency.toUpperCase(),
  });
  if (activationError) {
    console.error("Could not activate Rimbly Pro after verification:", activationError.message);
    return respond(response, 500, "Could not activate the verified payment.");
  }
  return respond(response, 200, "Payment verified and processed.");
}
