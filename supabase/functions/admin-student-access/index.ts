import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const configuredAppUrl = Deno.env.get("APP_URL");
const corsHeaders = {
  "Access-Control-Allow-Origin": configuredAppUrl ? new URL(configuredAppUrl).origin : "",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!token || !url || !anonKey || !serviceKey) {
    return Response.json(
      { error: "Student access service is not configured." },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json(
      { error: "A valid signed-in admin session is required." },
      {
        status: 401,
        headers: corsHeaders,
      },
    );
  }

  const { data: access, error: accessError } = await userClient.rpc("admin_get_access");
  if (accessError || !access?.permissions?.includes("students.manage")) {
    return Response.json(
      { error: "Student management permission is required." },
      {
        status: 403,
        headers: corsHeaders,
      },
    );
  }

  let payload: { userId?: string; suspended?: boolean };
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }
  if (
    !payload.userId ||
    payload.userId === userData.user.id ||
    typeof payload.suspended !== "boolean"
  ) {
    return Response.json(
      { error: "A valid student and access status are required." },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  const { error: authError } = await adminClient.auth.admin.updateUserById(payload.userId, {
    ban_duration: payload.suspended ? "876000h" : "none",
  });
  if (authError) {
    return Response.json({ error: authError.message }, { status: 400, headers: corsHeaders });
  }

  const { error: auditError } = await userClient.rpc("admin_set_student_suspension", {
    p_user_id: payload.userId,
    p_suspended: payload.suspended,
  });
  if (auditError) {
    const { error: rollbackError } = await adminClient.auth.admin.updateUserById(payload.userId, {
      ban_duration: payload.suspended ? "none" : "876000h",
    });
    const details = rollbackError
      ? `${auditError.message}; auth rollback also failed: ${rollbackError.message}`
      : auditError.message;
    return Response.json(
      { error: `Could not record the action: ${details}` },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  return Response.json({ updated: true }, { headers: corsHeaders });
});
