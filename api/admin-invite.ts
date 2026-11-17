import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

type InviteRequest = IncomingMessage & {
  body?: unknown;
};

type InvitePayload = {
  email?: unknown;
  role?: unknown;
};

function respond(response: ServerResponse, status: number, payload: Record<string, unknown>) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

function parsePayload(body: unknown): InvitePayload | null {
  let value = body;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as InvitePayload)
    : null;
}

export function createAdminInviteHandler(environment: Record<string, string | undefined>) {
  return async function handler(request: InviteRequest, response: ServerResponse) {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return respond(response, 405, { error: "Method not allowed." });
    }

    const accessToken = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) return respond(response, 401, { error: "Sign in to invite a team member." });

    const supabaseUrl = environment.VITE_SUPABASE_URL;
    const anonKey = environment.VITE_SUPABASE_ANON_KEY;
    const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
    const appUrlValue = environment.APP_URL;
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !appUrlValue) {
      return respond(response, 503, {
        error:
          "Team invitations are not configured. Ask an administrator to finish the server setup.",
      });
    }

    let appUrl: URL;
    try {
      appUrl = new URL(appUrlValue);
    } catch {
      return respond(response, 503, { error: "APP_URL must be a valid absolute URL." });
    }
    if (
      appUrl.protocol !== "https:" &&
      !(appUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(appUrl.hostname))
    ) {
      return respond(response, 503, { error: "APP_URL must use HTTPS." });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    try {
      const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
      if (userError || !userData.user) {
        return respond(response, 401, { error: "A valid signed-in admin session is required." });
      }

      const { data: access, error: accessError } = await userClient.rpc("admin_get_access");
      const permissions = Array.isArray(access?.permissions) ? access.permissions : [];
      if (accessError || !permissions.includes("team.manage")) {
        return respond(response, 403, { error: "Team management permission is required." });
      }

      const payload = parsePayload(request.body);
      const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
      const role = payload?.role;
      if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return respond(response, 400, { error: "Enter a valid email address." });
      }
      if (email === userData.user.email?.trim().toLowerCase()) {
        return respond(response, 400, { error: "You cannot invite yourself." });
      }
      if (!["admin", "moderator", "super_admin"].includes(String(role))) {
        return respond(response, 400, { error: "Choose a valid administrator role." });
      }
      if (role === "super_admin" && access?.role !== "super_admin") {
        return respond(response, 403, {
          error: "Only a Super Admin may invite another Super Admin.",
        });
      }

      const redirectTo = new URL("/#/admin", appUrl).toString();
      const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        { redirectTo },
      );
      if (inviteError || !invited.user) {
        return respond(response, 400, {
          error: inviteError?.message ?? "Could not send the invitation email.",
        });
      }

      const { error: recordError } = await userClient.rpc("admin_record_invitation", {
        p_user_id: invited.user.id,
        p_email: email,
        p_role_id: role,
      });
      if (recordError) {
        console.error("Could not record the administrator invitation:", recordError.message);
        return respond(response, 500, {
          error: "The invitation was sent, but its administrator role could not be recorded.",
        });
      }

      return respond(response, 200, { invited: true });
    } catch (error) {
      console.error("Admin invitation request failed:", error);
      return respond(response, 500, { error: "Could not process the team invitation." });
    }
  };
}

export default createAdminInviteHandler(process.env);
