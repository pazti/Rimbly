import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export type SubmissionTable = "waitlist" | "suggestions" | "contributions";

export async function getTableCount(table: SubmissionTable) {
  if (!supabase) {
    console.warn(`Supabase is not configured; skipping count lookup for ${table}.`);
    return { count: null, error: null };
  }

  const { count, error } = await supabase.from(table).select("*", {
    count: "exact",
    head: true,
  });

  return { count, error };
}

export async function insertSubmission(
  table: SubmissionTable,
  payload: Record<string, string | number | boolean | null>,
) {
  if (!supabase) {
    console.warn(`Supabase is not configured; skipping insert to ${table}.`);
    return { data: null, error: null };
  }

  const { data, error } = await supabase.from(table).insert(payload).select();
  return { data, error };
}
