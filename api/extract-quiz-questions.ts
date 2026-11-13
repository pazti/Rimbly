import type { IncomingMessage, ServerResponse } from "node:http";
import { handleQuizExtraction } from "../src/server/quiz-extraction";

type VercelRequest = IncomingMessage & { body?: unknown };

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
};

export default async function handler(request: VercelRequest, response: ServerResponse) {
  try {
    const forwardedHost = request.headers["x-forwarded-host"];
    const host =
      (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ??
      request.headers.host ??
      "localhost";
    const forwardedProtocol = request.headers["x-forwarded-proto"];
    const protocol =
      (Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol) ?? "https";
    const headers = new Headers();
    for (const name of ["authorization", "content-type", "origin"]) {
      const value = request.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }

    const rawBody = request.body;
    const body =
      typeof rawBody === "string"
        ? rawBody
        : Buffer.isBuffer(rawBody)
          ? rawBody.toString("utf8")
          : rawBody === undefined
            ? undefined
            : JSON.stringify(rawBody);
    const webRequest = new Request(`${protocol}://${host}${request.url ?? "/"}`, {
      method: request.method ?? "GET",
      headers,
      body,
    });
    const result = await handleQuizExtraction(webRequest, {
      GROQ_API_KEY: process.env.GROQ_API_KEY,
      GROQ_MODEL: process.env.GROQ_MODEL,
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    });

    response.statusCode = result.status;
    result.headers.forEach((value, name) => response.setHeader(name, value));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.statusCode = 500;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify({ error: "Question extraction failed unexpectedly." }));
  }
}
