import type { SubmissionTable } from "./supabase";

export type SubmissionErrorState = "offline" | "duplicate" | "generic";

export const duplicateMessages: Record<SubmissionTable, string> = {
  waitlist: "This email is already on the waitlist. You’re already in line.",
  suggestions: "You’ve already shared that suggestion. Thanks for helping us improve Rimbly.",
  contributions: "This contribution has already been submitted. Thanks for helping the archive grow.",
};

export function isDuplicateError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;

  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "23505" ||
    message.includes("duplicate") ||
    message.includes("already exists") ||
    message.includes("unique constraint")
  );
}

export function getSubmissionErrorMessage(
  table: SubmissionTable,
  error: { code?: string; message?: string } | null | undefined,
) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "You’re offline right now. Please reconnect and try again.";
  }

  if (isDuplicateError(error)) {
    return duplicateMessages[table];
  }

  if (error) {
    return "Something went wrong while saving your details. Please try again in a moment.";
  }

  return null;
}
