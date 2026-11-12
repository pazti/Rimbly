import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const appUrl = Deno.env.get("APP_URL");
const corsHeaders = {
  "Access-Control-Allow-Origin": appUrl ? new URL(appUrl).origin : "",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const groqApiKey = Deno.env.get("GROQ_API_KEY");
  if (!token || !supabaseUrl || !anonKey || !serviceKey || !appUrl || !groqApiKey) {
    return Response.json(
      { error: "Question extraction is not configured. Contact a Rimbly administrator." },
      { status: 503, headers: corsHeaders },
    );
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json(
      { error: "A valid signed-in admin session is required." },
      { status: 401, headers: corsHeaders },
    );
  }

  const { data: access, error: accessError } = await userClient.rpc("admin_get_access");
  if (accessError || !access?.permissions?.includes("quiz.manage")) {
    return Response.json(
      { error: "Quiz management permission is required." },
      { status: 403, headers: corsHeaders },
    );
  }

  let paperId: string | undefined;
  let inputImages: unknown;
  try {
    const body = await request.json();
    paperId = body?.paper_id;
    inputImages = body?.images;
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400, headers: corsHeaders },
    );
  }
  if (typeof paperId !== "string" || !/^[0-9a-f-]{36}$/i.test(paperId)) {
    return Response.json(
      { error: "Choose an approved source paper to extract." },
      { status: 400, headers: corsHeaders },
    );
  }
  if (!Array.isArray(inputImages) || inputImages.length < 1 || inputImages.length > 3) {
    return Response.json(
      { error: "Send one to three rendered source pages per extraction request." },
      { status: 400, headers: corsHeaders },
    );
  }
  let totalEncodedSize = 0;
  const sourceImages = inputImages.flatMap((image) => {
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
    if (!match || match[1].length > 2_500_000) return [];
    totalEncodedSize += match[1].length;
    return [
      {
        page_number: Number(candidate.page_number),
        data_url: candidate.data_url,
      },
    ];
  });
  if (sourceImages.length !== inputImages.length || totalEncodedSize > 5_000_000) {
    return Response.json(
      { error: "Rendered source pages are invalid or too large to extract." },
      { status: 413, headers: corsHeaders },
    );
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: paper, error: paperError } = await serviceClient
    .from("papers")
    .select("id")
    .eq("id", paperId)
    .eq("status", "approved")
    .maybeSingle();
  if (paperError || !paper) {
    return Response.json(
      { error: paperError?.message ?? "The approved source paper could not be found." },
      { status: 404, headers: corsHeaders },
    );
  }

  const model = Deno.env.get("GROQ_MODEL") || "qwen/qwen3.8-27b";
  const messageContent = [
    {
      type: "text",
      text: `Extract clearly legible exam questions and options from the following original paper page images. The page labels are the original page numbers; use them in source_page. Do not invent or complete missing content. Set correct_index only when an answer key is explicitly present and reliable; otherwise use null. Use zero-based option indexes. Include an explanation only when the source provides one. Return an empty questions array if no usable questions are present.`,
    },
    ...sourceImages.flatMap((image) => [
      { type: "text", text: `Original page ${image.page_number}` },
      { type: "image_url", image_url: { url: image.data_url } },
    ]),
  ];
  let response: Response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: messageContent,
          },
        ],
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
    });
  } catch {
    return Response.json(
      { error: "Could not connect to the question extraction provider." },
      { status: 502, headers: corsHeaders },
    );
  }
  if (!response.ok) {
    console.error("Question extraction provider returned an error.", response.status);
    if (response.status === 429) {
      return Response.json(
        { error: "Groq's free-tier rate limit was reached. Wait briefly, then retry extraction." },
        { status: 429, headers: corsHeaders },
      );
    }
    return Response.json(
      { error: "Question extraction failed. Try again or enter questions manually." },
      { status: 502, headers: corsHeaders },
    );
  }

  let result: {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  try {
    result = await response.json();
  } catch {
    return Response.json(
      { error: "The extraction provider returned an unreadable response." },
      { status: 502, headers: corsHeaders },
    );
  }
  const outputText = result.choices?.[0]?.message?.content;
  if (typeof outputText !== "string") {
    return Response.json(
      { error: "The extraction provider returned no structured questions." },
      { status: 502, headers: corsHeaders },
    );
  }

  let extracted: unknown;
  try {
    extracted = JSON.parse(outputText);
  } catch {
    return Response.json(
      { error: "The extraction provider returned invalid structured data." },
      { status: 502, headers: corsHeaders },
    );
  }

  const suggestions = (extracted as { questions?: unknown })?.questions;
  if (!Array.isArray(suggestions)) {
    return Response.json(
      { error: "The extraction provider returned an invalid question list." },
      { status: 502, headers: corsHeaders },
    );
  }

  const questions = suggestions.slice(0, 100).flatMap((item) => {
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
    const candidateAnswer = candidate.correct_index;
    const correctIndex =
      Number.isInteger(candidateAnswer) &&
      Number(candidateAnswer) >= 0 &&
      Number(candidateAnswer) < options.length
        ? Number(candidateAnswer)
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

  return Response.json({ questions }, { headers: corsHeaders });
});
