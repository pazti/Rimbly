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
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: corsHeaders });
  }

  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!token || !url || !anonKey || !serviceKey) {
    return Response.json(
      { error: "Account deletion is not configured." },
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
      { error: "A valid signed-in session is required." },
      { status: 401, headers: corsHeaders },
    );
  }
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  const issuedAt = claimsData?.claims?.iat;
  if (claimsError || typeof issuedAt !== "number" || Date.now() / 1000 - issuedAt > 300) {
    return Response.json(
      { error: "Please confirm your password again before deleting your account." },
      { status: 401, headers: corsHeaders },
    );
  }

  const [contributionResult, quizResult] = await Promise.all([
    adminClient
      .from("contributions")
      .select("storage_path")
      .eq("user_id", userData.user.id)
      .not("storage_path", "is", null),
    adminClient
      .from("quiz_sets")
      .select("source_file_path")
      .eq("created_by", userData.user.id)
      .not("source_file_path", "is", null),
  ]);
  if (contributionResult.error || quizResult.error) {
    return Response.json(
      {
        error: `Could not prepare your uploaded files for deletion: ${
          contributionResult.error?.message ?? quizResult.error?.message
        }`,
      },
      { status: 500, headers: corsHeaders },
    );
  }

  const contributionPaths = [
    ...new Set(
      (contributionResult.data ?? [])
        .map((contribution) => contribution.storage_path)
        .filter((path): path is string => typeof path === "string" && path.length > 0),
    ),
  ];
  const quizSourcePaths = [
    ...new Set(
      (quizResult.data ?? [])
        .map((quiz) => quiz.source_file_path)
        .filter((path): path is string => typeof path === "string" && path.length > 0),
    ),
  ];
  const uploadedPaths = [...new Set([...contributionPaths, ...quizSourcePaths])];
  if (uploadedPaths.length) {
    const [papersResult, publishedQuizzesResult] = await Promise.all([
      adminClient.from("papers").select("file_path").in("file_path", uploadedPaths),
      adminClient
        .from("quiz_sets")
        .select("source_file_path")
        .eq("status", "published")
        .in("source_file_path", uploadedPaths),
    ]);
    if (papersResult.error || publishedQuizzesResult.error) {
      return Response.json(
        {
          error: `Could not check shared files: ${
            papersResult.error?.message ?? publishedQuizzesResult.error?.message
          }`,
        },
        { status: 500, headers: corsHeaders },
      );
    }

    const sharedPaths = new Set([
      ...(papersResult.data ?? []).map((paper) => paper.file_path),
      ...(publishedQuizzesResult.data ?? []).map((quiz) => quiz.source_file_path),
    ]);
    const privatePaths = uploadedPaths.filter((path) => !sharedPaths.has(path));
    if (privatePaths.length) {
      const { error: storageError } = await adminClient.storage
        .from("contributions")
        .remove(privatePaths);
      if (storageError) {
        return Response.json(
          { error: `Could not remove your private uploaded files: ${storageError.message}` },
          { status: 500, headers: corsHeaders },
        );
      }
    }
  }

  const email = userData.user.email;
  if (email) {
    for (const table of ["suggestions", "waitlist"] as const) {
      const { error: cleanupError } = await adminClient.from(table).delete().eq("email", email);
      if (cleanupError) {
        return Response.json(
          { error: `Could not remove your saved contact data: ${cleanupError.message}` },
          { status: 500, headers: corsHeaders },
        );
      }
    }
  }

  const { error: quizArchiveError } = await adminClient
    .from("quiz_sets")
    .update({ status: "archived" })
    .eq("created_by", userData.user.id)
    .neq("status", "published");
  if (quizArchiveError) {
    return Response.json(
      { error: `Could not archive your unpublished quizzes: ${quizArchiveError.message}` },
      { status: 500, headers: corsHeaders },
    );
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userData.user.id);
  if (deleteError) {
    return Response.json(
      { error: `Could not delete the account: ${deleteError.message}` },
      { status: 500, headers: corsHeaders },
    );
  }

  return Response.json({ deleted: true }, { headers: corsHeaders });
});
