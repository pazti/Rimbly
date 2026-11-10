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

  const authorization = request.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appUrl = Deno.env.get("APP_URL");
  if (!token || !url || !anonKey || !serviceKey || !appUrl) {
    return Response.json(
      { error: "Admin invitation service is not configured." },
      { status: 500, headers: corsHeaders },
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
  if (accessError || !access?.permissions?.includes("team.manage")) {
    return Response.json(
      { error: "Team management permission is required." },
      {
        status: 403,
        headers: corsHeaders,
      },
    );
  }

  let payload: { email?: string; role?: string };
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
  const email = payload.email?.trim().toLowerCase();
  const role = payload.role;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json(
      { error: "Enter a valid email address." },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }
  if (!["admin", "moderator", "super_admin"].includes(role ?? "")) {
    return Response.json(
      { error: "Choose a valid administrator role." },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }
  if (role === "super_admin" && access.role !== "super_admin") {
    return Response.json(
      { error: "Only a Super Admin may invite another Super Admin." },
      {
        status: 403,
        headers: corsHeaders,
      },
    );
  }

  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: `${appUrl.replace(/\/$/, "")}/#/admin` },
  );
  if (inviteError || !invited.user) {
    return Response.json(
      { error: inviteError?.message ?? "Could not send the invitation email." },
      { status: 400, headers: corsHeaders },
    );
  }

  const { error: recordError } = await userClient.rpc("admin_record_invitation", {
    p_user_id: invited.user.id,
    p_email: email,
    p_role_id: role,
  });
  if (recordError) {
    return Response.json(
      {
        error: `The invitation email was sent, but its admin role could not be recorded: ${recordError.message}`,
      },
      { status: 500, headers: corsHeaders },
    );
  }

  return Response.json({ invited: true }, { headers: corsHeaders });
});
