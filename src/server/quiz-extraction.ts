import { createClient } from "@supabase/supabase-js";

type ExtractionEnvironment = {
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

type SourceImage = {
  page_number: number;
  data_url: string;
};

const MAX_IMAGE_SIZE = 2_500_000;
const MAX_BATCH_SIZE = 3_500_000;

const responseSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correct_index: { type: ["integer", "null"] },
          explanation: { type: ["string", "null"] },
          source_page: { type: ["integer", "null"] },
          source_note: { type: "string" },
        },
        required: [
          "prompt",
          "options",
          "correct_index",
          "explanation",
          "source_page",
          "source_note",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const jsonResponse = (body: unknown, status = 200, responseHeaders: Record<string, string> = {}) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...responseHeaders },
  });

const parseRetryAfterSeconds = (value: string | null) => {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds));
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? null : Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export async function handleQuizExtraction(
  request: Request,
  environment: ExtractionEnvironment,
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse({ error: "A signed-in admin session is required." }, 401);

  const supabaseUrl = environment.VITE_SUPABASE_URL;
  const anonKey = environment.VITE_SUPABASE_ANON_KEY;
  const groqApiKey = environment.GROQ_API_KEY;
  if (!supabaseUrl || !anonKey || !groqApiKey) {
    return jsonResponse({ error: "Question extraction is not configured." }, 503);
  }

  let body: { paper_id?: unknown; images?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  const paperId = body.paper_id;
  if (typeof paperId !== "string" || !/^[0-9a-f-]{36}$/i.test(paperId)) {
    return jsonResponse({ error: "Choose an approved source paper to extract." }, 400);
  }
  if (!Array.isArray(body.images) || body.images.length < 1 || body.images.length > 3) {
    return jsonResponse(
      { error: "Send one to three rendered source pages per extraction request." },
      400,
    );
  }

  let totalEncodedSize = 0;
  const images = body.images.flatMap((image): SourceImage[] => {
    if (!image || typeof image !== "object") return [];
    const candidate = image as Record<string, unknown>;
    if (
      !Number.isInteger(candidate.page_number) ||
      Number(candidate.page_number) < 1 ||
      Number(candidate.page_number) > 100_000 ||
      typeof candidate.data_url !== "string"
    ) {
      return [];
    }
    const match = candidate.data_url.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[1].length > MAX_IMAGE_SIZE) return [];
    totalEncodedSize += match[1].length;
    return [{ page_number: Number(candidate.page_number), data_url: candidate.data_url }];
  });

  if (images.length !== body.images.length || totalEncodedSize > MAX_BATCH_SIZE) {
    return jsonResponse(
      { error: "Rendered source pages are invalid or too large to extract." },
      413,
    );
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse({ error: "A valid signed-in admin session is required." }, 401);
  }

  const { data: access, error: accessError } = await userClient.rpc("admin_get_access");
  if (accessError || !access?.permissions?.includes("quiz.manage")) {
    return jsonResponse({ error: "Quiz management permission is required." }, 403);
  }

  const { data: approvedPapers, error: papersError } =
    await userClient.rpc("admin_list_quiz_papers");
  if (papersError) {
    return jsonResponse({ error: "Could not verify the approved source paper." }, 500);
  }
  if (!approvedPapers?.some((paper: { id?: string }) => paper.id === paperId)) {
    return jsonResponse({ error: "The approved source paper could not be found." }, 404);
  }

  const messageContent = images.flatMap((image) => [
    {
      type: "text",
      text: `Extract clearly legible exam questions and options from the following original paper page image. The page label is the original page number; use it in source_page. Do not invent or complete missing content. Set correct_index only when an answer key is explicitly present and reliable; otherwise use null. Use zero-based option indexes. Include an explanation only when the source provides one. Return an empty questions array if no usable questions are present. Original page ${image.page_number}.`,
    },
    { type: "image_url", image_url: { url: image.data_url } },
  ]);

  let providerResponse: Response;
  try {
    providerResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: environment.GROQ_MODEL || "qwen/qwen3.8-27b",
        messages: [{ role: "user", content: messageContent }],
        temperature: 0,
        max_completion_tokens: 4096,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "rimbly_question_extraction",
            strict: true,
            schema: responseSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return jsonResponse({ error: "Could not connect to the question extraction provider." }, 502);
  }

  if (!providerResponse.ok) {
    if (providerResponse.status === 429) {
      const retryAfter = providerResponse.headers.get("retry-after");
      return jsonResponse(
        {
          error: "Groq temporarily rate-limited this extraction.",
          retry_after_seconds: parseRetryAfterSeconds(retryAfter),
        },
        429,
        retryAfter ? { "Retry-After": retryAfter } : {},
      );
    }
    console.error("Question extraction provider returned an error.", providerResponse.status);
    return jsonResponse(
      { error: "Question extraction failed. Try again or enter questions manually." },
      502,
    );
  }

  let result: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    result = await providerResponse.json();
  } catch {
    return jsonResponse({ error: "The extraction provider returned an unreadable response." }, 502);
  }

  const outputText = result.choices?.[0]?.message?.content;
  if (typeof outputText !== "string") {
    return jsonResponse(
      { error: "The extraction provider returned no structured questions." },
      502,
    );
  }

  let extracted: unknown;
  try {
    extracted = JSON.parse(outputText);
  } catch {
    return jsonResponse(
      { error: "The extraction provider returned invalid structured data." },
      502,
    );
  }

  const candidates = (extracted as { questions?: unknown })?.questions;
  if (!Array.isArray(candidates)) {
    return jsonResponse(
      { error: "The extraction provider returned an invalid question list." },
      502,
    );
  }

  const questions = candidates.slice(0, 100).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.prompt !== "string" ||
      !candidate.prompt.trim() ||
      candidate.prompt.length > 2000 ||
      !isStringArray(candidate.options) ||
      candidate.options.length < 2 ||
      candidate.options.length > 6
    ) {
      return [];
    }
    const options = candidate.options.map((option) => option.trim());
    if (options.some((option) => !option || option.length > 500)) return [];
    const correctIndex =
      Number.isInteger(candidate.correct_index) &&
      Number(candidate.correct_index) >= 0 &&
      Number(candidate.correct_index) < options.length
        ? Number(candidate.correct_index)
        : null;
    return [
      {
        prompt: candidate.prompt.trim(),
        options,
        correct_index: correctIndex,
        explanation:
          typeof candidate.explanation === "string" ? candidate.explanation.slice(0, 2000) : "",
        source_page:
          Number.isInteger(candidate.source_page) &&
          Number(candidate.source_page) > 0 &&
          Number(candidate.source_page) <= 100_000
            ? Number(candidate.source_page)
            : null,
        source_note:
          typeof candidate.source_note === "string" ? candidate.source_note.slice(0, 500) : "",
      },
    ];
  });

  return jsonResponse({ questions });
}
