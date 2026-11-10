import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

const isValidUrl = (value: string) => {
  try {
    const url = new URL(value);
    const secure = url.protocol === "https:";
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    return (secure || local) && !/your-|example|placeholder/i.test(url.hostname);
  } catch {
    return false;
  }
};

export const supabaseConfigurationError =
  !isValidUrl(supabaseUrl) || !supabaseAnonKey || /your-|example|placeholder/i.test(supabaseAnonKey)
    ? "The app database is not configured. Add the project URL and public anon key to .env, then restart the app."
    : null;

export const supabase =
  !supabaseConfigurationError && supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;
