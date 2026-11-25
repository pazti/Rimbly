import { timingSafeEqual } from "node:crypto";
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

function validSignature(signature: string | undefined, secretHash: string) {
  if (!signature) return false;
  const expected = Buffer.from(secretHash);
  const received = Buffer.from(signature);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function webhookDetails(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const data = record.data;
  if (record.event !== "charge.completed" || !data || typeof data !== "object") return null;
  const transaction = data as Record<string, unknown>;
  const transactionRef = transaction.tx_ref;
  const id = transaction.id;
  const transactionId =
    typeof id === "number" && Number.isSafeInteger(id) && id > 0
      ? String(id)
      : typeof id === "string" && /^\d{1,20}$/.test(id)
        ? id
        : null;
  if (
    typeof transactionRef !== "string" ||
    !/^rimbly_[a-f0-9]{32}$/.test(transactionRef) ||
    !transactionId
  ) {
    return null;
  }
  return { transactionId, transactionRef };
}

function amountToKobo(value: unknown): number | null {
  const amountText =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountText)) return null;
  const [whole, fraction = ""] = amountText.split(".");
  const amountKobo = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amountKobo) ? amountKobo : null;
}

export default async function handler(request: WebhookRequest, response: ServerResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return respond(response, 405, "Method not allowed.");
  }

  const secretKey = process.env.FLW_SECRET_KEY;
  const secretHash = process.env.FLW_SECRET_HASH;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey || !secretHash || !supabaseUrl || !serviceRoleKey) {
    console.error("Flutterwave webhook is not configured.");
    return respond(response, 503, "Webhook is not configured.");
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(request);
  } catch (readError) {
    const message = readError instanceof Error ? readError.message : "Could not read webhook body.";
    return respond(response, 413, message);
  }

  const signature = request.headers["verif-hash"];
  const signatureValue = Array.isArray(signature) ? signature[0] : signature;
  if (!validSignature(signatureValue, secretHash)) {
    return respond(response, 401, "Invalid Flutterwave signature.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return respond(response, 400, "Invalid webhook JSON.");
  }
  const details = webhookDetails(payload);
  if (!details)
    return respond(response, 400, "Payment event is missing valid transaction details.");

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: payment, error: paymentError } = await serviceClient
    .from("rimbly_billing_payments")
    .select("status")
    .eq("transaction_ref", details.transactionRef)
    .maybeSingle();
  if (paymentError) {
    console.error("Could not find Rimbly Pro payment:", paymentError.message);
    return respond(response, 500, "Could not process this payment.");
  }
  if (!payment) return respond(response, 200, "Transaction reference is not for Rimbly Pro.");
  if (payment.status === "paid") return respond(response, 200, "Payment already processed.");

  let verificationResponse: Response;
  try {
    verificationResponse = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(details.transactionId)}/verify`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    );
  } catch (verifyError) {
    const message = verifyError instanceof Error ? verifyError.message : "Network error";
    console.error("Flutterwave transaction verification failed:", message);
    return respond(response, 502, "Could not verify the payment with Flutterwave.");
  }

  const verification = (await verificationResponse.json().catch(() => null)) as {
    status?: unknown;
    data?: Record<string, unknown>;
  } | null;
  if (!verificationResponse.ok || verification?.status !== "success" || !verification.data) {
    console.error("Flutterwave transaction verification returned an invalid response.");
    return respond(response, 502, "Could not verify the payment with Flutterwave.");
  }

  const verified = verification.data;
  if (String(verified.id) !== details.transactionId || verified.tx_ref !== details.transactionRef) {
    return respond(response, 400, "Verified transaction details do not match.");
  }

  const status = typeof verified.status === "string" ? verified.status.toLowerCase() : "";
  if (status !== "successful") {
    if (status === "failed") {
      // Flutterwave checkout may still accept another attempt with the same reference.
      return respond(response, 200, "Payment was not successful.");
    }
    if (status === "pending") return respond(response, 503, "Payment is still pending.");
    return respond(response, 502, "Flutterwave returned an unknown transaction status.");
  }

  const amountKobo = amountToKobo(verified.amount);
  const currency = typeof verified.currency === "string" ? verified.currency.toUpperCase() : "";
  if (amountKobo === null || currency !== "NGN") {
    return respond(response, 400, "Verified payment amount or currency is invalid.");
  }

  const { error: activationError } = await serviceClient.rpc("activate_rimbly_pro_payment", {
    p_transaction_ref: details.transactionRef,
    p_amount_kobo: amountKobo,
    p_currency: currency,
  });
  if (activationError) {
    console.error(
      "Could not activate Rimbly Pro after Flutterwave verification:",
      activationError.message,
    );
    return respond(response, 500, "Could not activate the verified payment.");
  }
  return respond(response, 200, "Payment verified and processed.");
}
