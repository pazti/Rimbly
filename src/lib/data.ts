import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { RimblyPlanId } from "./monetization";

export interface Profile {
  id: string;
  full_name: string;
  university: string | null;
  faculty: string | null;
  department: string | null;
  level: string | null;
  created_at: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  university: string;
  faculty: string | null;
  department: string | null;
  level: string | null;
  semester: string | null;
  is_verified: boolean;
}

export interface Paper {
  id: string;
  course_id: string;
  academic_session: string;
  semester: string | null;
  exam_year: number | null;
  file_path: string;
  page_count: number | null;
  is_verified: boolean;
  created_at: string;
}

export interface PublicQuestion {
  id: string;
  paper_id: string | null;
  quiz_id?: string | null;
  position: number;
  prompt: string;
  options: string[];
  explanation?: string | null;
}

export type QuizQuestionReviewStatus = "pending" | "approved" | "rejected";

export interface QuizSet {
  id: string;
  title: string;
  description: string;
  paper_id: string | null;
  course_code: string | null;
  course_title: string | null;
  course_department: string | null;
  university: string | null;
  audience_university: string | null;
  audience_department: string | null;
  audience_level: string | null;
  source_file_path: string | null;
  source_file_name: string | null;
  question_count: number;
  created_at: string;
}

export interface AdminQuizSet {
  id: string;
  title: string;
  description: string;
  paper_id: string | null;
  replaces_quiz_id: string | null;
  question_count: number;
  created_at: string;
  audience_university: string | null;
  audience_department: string | null;
  audience_level: string | null;
  status: "draft" | "pending_review" | "needs_revision" | "published" | "archived";
  created_by: string;
  creator_name: string;
}

export interface AdminQuizDraft {
  id: string;
  title: string;
  description: string;
  paper_id: string | null;
  replaces_quiz_id: string | null;
  audience_university: string | null;
  audience_department: string | null;
  audience_level: string | null;
  source_file_path: string | null;
  source_file_name: string | null;
  review_status: AdminQuizSet["status"];
  questions: Array<{
    prompt: string;
    options: string[];
    correct_index: number | null;
    explanation: string;
    review_status: QuizQuestionReviewStatus;
    source_page: number | null;
    source_note: string;
  }>;
}

export type AdminQuizPaper = AdminPaper;

export interface QuizAttempt {
  id: string;
  paper_id: string | null;
  quiz_id?: string | null;
  quiz_title?: string | null;
  score_percent: number;
  previous_score_percent?: number;
  correct_count: number;
  total_questions: number;
  duration_seconds: number;
  created_at: string;
  points_earned?: number;
}

export interface Leader {
  user_id: string;
  full_name: string;
  university: string | null;
  points: number;
  quizzes_completed: number;
  battle_wins?: number;
  battle_losses?: number;
  current_win_streak?: number;
  best_win_streak?: number;
  title?: string;
  is_pro?: boolean;
}

export interface RimblyBillingStatus {
  is_pro: boolean;
  plan_id: RimblyPlanId | "free";
  expires_at: string | null;
  quizzes_used_today: number;
  free_quiz_limit: number;
  battle_invites_used_today: number;
  free_battle_limit: number;
  completed_battles_today: number;
  did_practice_today: boolean;
  latest_payment_ref: string | null;
  latest_payment_status: "pending" | "paid" | "failed" | null;
}

export interface QuizAttemptReviewItem {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  correct_index: number;
  selected_index: number;
  explanation: string;
}

export interface PlayerBadge {
  badge_id: "first_win" | "perfect_score" | "speed_demon" | "daily_7";
  earned_at: string;
}

export interface GameProgress {
  points: number;
  quizzes_completed: number;
  battles_played: number;
  battle_wins: number;
  battle_losses: number;
  current_win_streak: number;
  best_win_streak: number;
  current_daily_streak: number;
  best_daily_streak: number;
  title: string;
  badges: PlayerBadge[];
}

export interface BattleOpponent {
  user_id: string;
  full_name: string;
  university: string;
}

export interface Battle {
  id: string;
  quiz_id: string;
  quiz_title: string;
  challenger_id: string;
  challenger_name: string;
  challenged_id: string;
  challenged_name: string;
  status: "pending" | "active" | "completed" | "declined" | "cancelled";
  winner_id: string | null;
  is_draw: boolean;
  your_submission: boolean;
  opponent_submission: boolean;
  your_correct_count: number | null;
  opponent_correct_count: number | null;
  your_duration_seconds: number | null;
  opponent_duration_seconds: number | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface Contribution {
  id: string;
  course_code: string;
  course_title: string;
  exam_year: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export interface University {
  id: string;
  name: string;
}

export interface AdminAccess {
  role: "super_admin" | "admin" | "moderator";
  permissions: string[];
}

export interface AdminOverview {
  students: number;
  courses: number;
  published_papers: number;
  pending_contributions: number;
  quiz_attempts: number;
  active_admins: number;
}

export interface AdminContribution {
  id: string;
  user_id: string;
  contributor_name: string;
  contributor_email: string;
  university: string;
  course_code: string;
  course_title: string;
  level: string | null;
  semester: string | null;
  exam_year: number;
  academic_session: string | null;
  notes: string | null;
  question_file_name: string | null;
  storage_path: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  created_at: string;
}

export interface AdminAuditLog {
  id: number;
  actor_id: string | null;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AdminTeamMember {
  user_id: string;
  email: string;
  full_name: string | null;
  role_id: "super_admin" | "admin" | "moderator";
  status: "invited" | "active" | "suspended" | "revoked";
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
}

export interface AdminStudent {
  user_id: string;
  full_name: string;
  email: string;
  university: string | null;
  department: string | null;
  level: string | null;
  created_at: string;
  suspended: boolean;
}

export interface AdminPaper {
  id: string;
  course_id: string;
  university: string;
  course_code: string;
  course_title: string;
  academic_session: string;
  semester: string | null;
  exam_year: number | null;
  file_path: string;
  status: string;
  created_at: string;
}

export interface MaintenanceStatus {
  active: boolean;
  title: string;
  message: string;
  ends_at: string | null;
  updated_at: string;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      "The app database is not configured. Add the project URL and public anon key to .env.",
    );
  }
  return supabase;
}

export async function getProfile(userId: string) {
  const { data, error } = await requireSupabase()
    .from("profiles")
    .select("id, full_name, university, faculty, department, level, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function saveProfile(
  user: User,
  profile: Pick<Profile, "full_name" | "university" | "faculty" | "department" | "level">,
) {
  const { data, error } = await requireSupabase()
    .from("profiles")
    .upsert({ id: user.id, ...profile }, { onConflict: "id" })
    .select("id, full_name, university, faculty, department, level, created_at")
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function getCourses() {
  const { data, error } = await requireSupabase()
    .from("courses")
    .select("id, code, title, university, faculty, department, level, semester, is_verified")
    .order("code");
  if (error) throw error;
  return (data ?? []) as Course[];
}

export async function getUniversities() {
  const { data, error } = await requireSupabase()
    .from("universities")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []) as University[];
}

export async function getPapers(courseId?: string) {
  let query = requireSupabase()
    .from("papers")
    .select(
      "id, course_id, academic_session, semester, exam_year, file_path, page_count, is_verified, created_at",
    )
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  if (courseId) query = query.eq("course_id", courseId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Paper[];
}

export async function getPaperReaderUrl(path: string) {
  const { data, error } = await requireSupabase()
    .storage.from("contributions")
    .createSignedUrl(path, 600);
  if (error) throw error;
  const readerUrl = new URL(data.signedUrl);
  readerUrl.hash = "toolbar=0&navpanes=0&scrollbar=0";
  return readerUrl.toString();
}

export async function getQuestions(paperId: string) {
  const { data, error } = await requireSupabase()
    .from("published_questions")
    .select("id, paper_id, position, prompt, options")
    .eq("paper_id", paperId)
    .order("position");
  if (error) throw error;
  return (data ?? []) as PublicQuestion[];
}

export async function getPublishedQuizSets() {
  const { data, error } = await requireSupabase().rpc("get_published_quiz_sets_for_current_user");
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "The quiz audience labels and optional source paper migration has not been applied yet. Apply supabase/quiz-audience-targeting.sql through the project's authorized migration workflow.",
      );
    }
    throw error;
  }
  return (data ?? []) as QuizSet[];
}

export async function getQuizSetQuestions(quizId: string) {
  const { data, error } = await requireSupabase().rpc("get_quiz_set_questions", {
    p_quiz_id: quizId,
  });
  if (error) throw error;
  return (data ?? []) as PublicQuestion[];
}

export async function submitQuizSet(
  quizId: string,
  answers: Record<string, number>,
  durationSeconds: number,
  submissionKey: string,
) {
  const client = requireSupabase();
  const result = await client.rpc("submit_quiz_set_attempt", {
    p_quiz_id: quizId,
    p_answers: answers,
    p_duration_seconds: durationSeconds,
    p_submission_key: submissionKey,
  });
  if (result.error?.code === "PGRST202" || result.error?.code === "42883") {
    const legacyResult = await client.rpc("submit_quiz_set_attempt", {
      p_quiz_id: quizId,
      p_answers: answers,
      p_duration_seconds: durationSeconds,
    });
    if (legacyResult.error) throw legacyResult.error;
    return legacyResult.data as QuizAttempt;
  }
  if (result.error) throw result.error;
  return result.data as QuizAttempt;
}

export async function submitQuiz(
  paperId: string,
  answers: Record<string, number>,
  durationSeconds: number,
) {
  const { data, error } = await requireSupabase().rpc("submit_quiz_attempt", {
    p_paper_id: paperId,
    p_answers: answers,
    p_duration_seconds: durationSeconds,
  });
  if (error) throw error;
  return data as QuizAttempt;
}

export async function getQuizAttempts(userId: string) {
  const client = requireSupabase();
  const [{ data, error }, { data: quizSetAttempts, error: quizSetError }] = await Promise.all([
    client
      .from("quiz_attempts")
      .select(
        "id, paper_id, score_percent, correct_count, total_questions, duration_seconds, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    client.rpc("get_my_quiz_set_attempts"),
  ]);
  if (error) throw error;
  if (quizSetError) throw quizSetError;
  return [...((data ?? []) as QuizAttempt[]), ...((quizSetAttempts ?? []) as QuizAttempt[])].sort(
    (first, second) => second.created_at.localeCompare(first.created_at),
  );
}

export async function getQuizAttemptReview(attemptId: string) {
  const { data, error } = await requireSupabase().rpc("get_quiz_attempt_review", {
    p_attempt_id: attemptId,
  });
  if (error) throw error;
  return (data ?? []) as QuizAttemptReviewItem[];
}

export async function getLeaderboard(
  university?: string | null,
  period: "all-time" | "weekly" = "all-time",
) {
  const { data, error } = await requireSupabase().rpc("get_game_leaderboard", {
    p_university: university ?? null,
    p_period: period,
  });
  if (error) throw error;
  return (data ?? []) as Leader[];
}

export async function getGameProgress() {
  const { data, error } = await requireSupabase().rpc("get_my_game_progress");
  if (error) throw error;
  return data as GameProgress;
}

export async function getMyRimblyBillingStatus() {
  const { data, error } = await requireSupabase().rpc("get_my_rimbly_billing_status");
  if (error) throw error;
  return data as RimblyBillingStatus;
}

export async function getAdminQuizSets() {
  const { data, error } = await requireSupabase().rpc("admin_list_quiz_sets_with_audience");
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "The quiz audience labels and optional source paper migration has not been applied yet. Apply supabase/quiz-audience-targeting.sql through the project's authorized migration workflow.",
      );
    }
    throw error;
  }
  return (data ?? []) as AdminQuizSet[];
}

export async function getAdminQuizDraft(quizId: string) {
  const { data, error } = await requireSupabase().rpc("admin_get_quiz_draft_with_audience", {
    p_quiz_id: quizId,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "The quiz audience labels and optional source paper migration has not been applied yet. Apply supabase/quiz-audience-targeting.sql through the project's authorized migration workflow.",
      );
    }
    throw error;
  }
  return data as AdminQuizDraft;
}

export async function getAdminQuizPapers() {
  const { data, error } = await requireSupabase().rpc("admin_list_quiz_papers");
  if (error) throw error;
  return (data ?? []) as AdminQuizPaper[];
}

export async function createAdminQuizRevision(quizId: string) {
  const { data, error } = await requireSupabase().rpc("admin_create_quiz_revision", {
    p_quiz_id: quizId,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "Published-quiz revisions are not installed yet. Apply supabase/quiz-revisions.sql through the project's authorized migration workflow.",
      );
    }
    throw error;
  }
  return data as string;
}

export async function publishAdminQuiz(quizId: string) {
  const { error } = await requireSupabase().rpc("admin_publish_quiz", {
    p_quiz_id: quizId,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "Direct quiz publishing is not installed yet. Apply supabase/quiz-revisions.sql through the project's authorized migration workflow.",
      );
    }
    throw error;
  }
}

export async function archiveAdminQuizSet(quizId: string) {
  const { error } = await requireSupabase().rpc("admin_archive_quiz_set", {
    p_quiz_id: quizId,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "Quiz deletion is not installed yet. Apply supabase/quiz-revisions.sql through the project's authorized migration workflow.",
      );
    }
    throw error;
  }
}

export async function saveAdminQuizDraft(input: {
  id: string | null;
  title: string;
  description: string;
  paperId: string | null;
  audienceUniversity: string;
  audienceDepartment: string;
  audienceLevel: string;
  sourceFile?: File | null;
  questions: Array<{
    prompt: string;
    options: string[];
    correct_index: number | null;
    explanation: string;
    review_status: QuizQuestionReviewStatus;
    source_page: number | null;
    source_note: string;
  }>;
}) {
  const client = requireSupabase();
  let sourcePath: string | null = null;
  if (input.sourceFile) {
    if (
      input.sourceFile.size > 20 * 1024 * 1024 ||
      !["application/pdf", "image/jpeg", "image/png"].includes(input.sourceFile.type)
    ) {
      throw new Error("Choose a PDF, JPG, or PNG source document up to 20 MB.");
    }
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (!userData.user) throw new Error("Sign in again before saving this quiz.");
    sourcePath = `${userData.user.id}/quiz-sources/${crypto.randomUUID()}-${input.sourceFile.name}`;
    const { error: uploadError } = await client.storage
      .from("contributions")
      .upload(sourcePath, input.sourceFile, {
        contentType: input.sourceFile.type,
        upsert: false,
      });
    if (uploadError) throw uploadError;
  }
  const { data, error } = await client.rpc("admin_save_quiz_draft_with_audience", {
    p_quiz_id: input.id,
    p_title: input.title,
    p_description: input.description,
    p_paper_id: input.paperId,
    p_questions: input.questions,
    p_source_file_path: sourcePath,
    p_source_file_name: input.sourceFile?.name ?? null,
    p_audience_university: input.audienceUniversity || null,
    p_audience_department: input.audienceDepartment || null,
    p_audience_level: input.audienceLevel || null,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "The quiz audience labels and optional source paper migration has not been applied yet. Apply supabase/quiz-audience-targeting.sql through the project's authorized migration workflow.",
      );
    }
    throw error;
  }
  return data as string;
}

export async function requestAdminQuizReview(quizId: string) {
  const { error } = await requireSupabase().rpc("admin_request_quiz_review", {
    p_quiz_id: quizId,
  });
  if (error) throw error;
}

export async function reviewAdminQuiz(quizId: string, decision: "publish" | "needs_revision") {
  const { error } = await requireSupabase().rpc("admin_review_quiz_set", {
    p_quiz_id: quizId,
    p_decision: decision,
  });
  if (error) throw error;
}

type ExtractedQuizQuestion = {
  prompt: string;
  options: string[];
  correct_index: number | null;
  explanation: string;
  source_page: number | null;
  source_note: string;
};

type GroqSourceImage = {
  page_number: number;
  data_url: string;
};

type QuizExtractionResponse = {
  error?: unknown;
  questions?: unknown;
  retry_after_seconds?: unknown;
};

const MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS = 90;

const getRetryAfterSeconds = (response: Response, data: QuizExtractionResponse | null) => {
  const bodyValue = data?.retry_after_seconds;
  if (typeof bodyValue === "number" && Number.isFinite(bodyValue) && bodyValue >= 0) {
    return Math.max(1, Math.ceil(bodyValue));
  }
  const headerValue = response.headers.get("retry-after");
  if (!headerValue) return null;
  const headerSeconds = Number(headerValue);
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0)
    return Math.max(1, Math.ceil(headerSeconds));
  const retryAt = Date.parse(headerValue);
  return Number.isNaN(retryAt) ? null : Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
};

const formatRetryDelay = (seconds: number) =>
  seconds < 60
    ? `${seconds} seconds`
    : `${Math.floor(seconds / 60)} minute${Math.floor(seconds / 60) === 1 ? "" : "s"}${seconds % 60 ? ` ${seconds % 60} seconds` : ""}`;

async function waitForRateLimit(seconds: number, onProgress: (progress: string) => void) {
  const retryAt = Date.now() + seconds * 1000;
  while (Date.now() < retryAt) {
    const remaining = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
    onProgress(`Groq is rate-limiting extraction. Retrying in ${remaining}s…`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, remaining * 1000)));
  }
}

async function renderPaperPages(
  filePath: string,
  onProgress: (progress: string) => void,
): Promise<GroqSourceImage[]> {
  const signedUrl = await getPaperReaderUrl(filePath);
  const response = await fetch(signedUrl);
  if (!response.ok) throw new Error("Could not read the original paper for extraction.");
  const file = await response.blob();
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("The original paper exceeds the 20 MB extraction limit.");
  }

  const isPdf = file.type === "application/pdf" || /\.pdf(?:$|[?#])/i.test(filePath);
  if (!isPdf) {
    const image = await createImageBitmap(file);
    try {
      const scale = Math.min(2, 1440 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Could not prepare the original image for extraction.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return [{ page_number: 1, data_url: canvas.toDataURL("image/jpeg", 0.72) }];
    } finally {
      image.close();
    }
  }

  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = workerModule.default;
  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdfDocument = await loadingTask.promise;
  try {
    if (pdfDocument.numPages > 60) {
      throw new Error("PDF extraction is limited to 60 pages per run. Split the paper and retry.");
    }
    const pages: GroqSourceImage[] = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      onProgress(`Preparing PDF page ${pageNumber} of ${pdfDocument.numPages}…`);
      const page = await pdfDocument.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1280 / Math.max(baseViewport.width, baseViewport.height));
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Could not render a page of the original PDF.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push({
        page_number: pageNumber,
        data_url: canvas.toDataURL("image/jpeg", 0.72),
      });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractAdminQuizQuestions(
  paperId: string,
  filePath: string,
  onProgress: (progress: string) => void = () => {},
) {
  const sourceImages = await renderPaperPages(filePath, onProgress);
  const questions: ExtractedQuizQuestion[] = [];
  const client = requireSupabase();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error("Sign in again before extracting questions.");

  const batches: GroqSourceImage[][] = [];
  let currentBatch: GroqSourceImage[] = [];
  let currentBatchSize = 0;
  for (const image of sourceImages) {
    if (image.data_url.length > 2_500_000) {
      throw new Error(`PDF page ${image.page_number} is too large to send for extraction.`);
    }
    if (
      currentBatch.length &&
      (currentBatch.length >= 3 || currentBatchSize + image.data_url.length > 3_500_000)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchSize = 0;
    }
    currentBatch.push(image);
    currentBatchSize += image.data_url.length;
  }
  if (currentBatch.length) batches.push(currentBatch);

  for (const batch of batches) {
    onProgress(`Extracting pages ${batch[0].page_number}–${batch.at(-1)!.page_number}…`);
    try {
      let rateLimitRetries = 0;
      while (true) {
        const response = await fetch("/api/extract-quiz-questions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionData.session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ paper_id: paperId, images: batch }),
        });
        let data: QuizExtractionResponse | null = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        if (response.status === 429) {
          const retryAfterSeconds = getRetryAfterSeconds(response, data) ?? 5;
          if (
            rateLimitRetries === 0 &&
            retryAfterSeconds <= MAX_AUTOMATIC_RATE_LIMIT_WAIT_SECONDS
          ) {
            rateLimitRetries += 1;
            await waitForRateLimit(retryAfterSeconds, onProgress);
            continue;
          }
          throw new Error(
            `Groq is still rate-limited. Try again in ${formatRetryDelay(retryAfterSeconds)}.`,
          );
        }
        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "Question extraction failed.",
          );
        }
        if (!Array.isArray(data?.questions)) {
          throw new Error("The extraction service returned an invalid question list.");
        }
        questions.push(
          ...(data.questions as ExtractedQuizQuestion[]).map((question) => ({
            ...question,
            source_page: question.source_page ?? (batch.length === 1 ? batch[0].page_number : null),
          })),
        );
        break;
      }
    } catch (batchError) {
      if (!questions.length) throw batchError;
      return {
        questions,
        warning: `Extraction stopped after ${questions.length} suggestions: ${batchError instanceof Error ? batchError.message : "The next page batch failed."}`,
      };
    }
  }
  return { questions, warning: null };
}

export async function getBattleOpponents(search: string) {
  const { data, error } = await requireSupabase().rpc("search_battle_opponents", {
    p_search: search,
  });
  if (error) throw error;
  return (data ?? []) as BattleOpponent[];
}

export async function createBattle(quizId: string, opponentId: string) {
  const { data, error } = await requireSupabase().rpc("create_battle_challenge", {
    p_quiz_id: quizId,
    p_opponent_id: opponentId,
  });
  if (error) throw error;
  return data as string;
}

export async function getBattles() {
  const { data, error } = await requireSupabase().rpc("list_my_battles");
  if (error) throw error;
  return (data ?? []) as Battle[];
}

export async function respondToBattle(battleId: string, accept: boolean) {
  const { error } = await requireSupabase().rpc("respond_to_battle_challenge", {
    p_battle_id: battleId,
    p_accept: accept,
  });
  if (error) throw error;
}

export async function cancelBattle(battleId: string) {
  const { error } = await requireSupabase().rpc("cancel_battle_challenge", {
    p_battle_id: battleId,
  });
  if (error) throw error;
}

export async function getBattleQuestions(battleId: string) {
  const { data, error } = await requireSupabase().rpc("get_battle_questions", {
    p_battle_id: battleId,
  });
  if (error) throw error;
  return (data ?? []) as PublicQuestion[];
}

export async function submitBattle(battleId: string, answers: Record<string, number>) {
  const { data, error } = await requireSupabase().rpc("submit_battle_attempt", {
    p_battle_id: battleId,
    p_answers: answers,
  });
  if (error) throw error;
  return data as {
    battle_id: string;
    correct_count: number;
    total_questions: number;
    duration_seconds: number;
    status: "waiting_for_opponent" | "completed";
    winner_id: string | null;
    is_draw: boolean;
    your_streak: number;
    points_earned: number;
  };
}

export async function getSavedCourseIds(userId: string) {
  const { data, error } = await requireSupabase()
    .from("saved_courses")
    .select("course_id")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.course_id as string);
}

export async function toggleSavedCourse(userId: string, courseId: string, saved: boolean) {
  const client = requireSupabase();
  const result = saved
    ? await client.from("saved_courses").delete().eq("user_id", userId).eq("course_id", courseId)
    : await client.from("saved_courses").insert({ user_id: userId, course_id: courseId });
  if (result.error) throw result.error;
}

export async function getNotifications(userId: string) {
  const { data, error } = await requireSupabase()
    .from("notifications")
    .select("id, title, body, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function markNotificationsRead(userId: string) {
  const { error } = await requireSupabase()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
}

export async function getContributions(userId: string) {
  const { data, error } = await requireSupabase()
    .from("contributions")
    .select("id, course_code, course_title, exam_year, status, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Contribution[];
}

export async function createContribution(
  userId: string,
  contributor: { name: string; email: string },
  course: {
    university: string;
    course_code: string;
    course_title: string;
    exam_year: number;
    notes: string;
  },
  file: File,
  submissionKey: string,
) {
  const client = requireSupabase();
  const safeFileName = file.name.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 120) || "upload";
  const path = `${userId}/${crypto.randomUUID()}-${safeFileName}`;
  const { error: uploadError } = await client.storage.from("contributions").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const result = await client.rpc("submit_contribution", {
    p_submission_key: submissionKey,
    p_university: course.university,
    p_course_code: course.course_code,
    p_course_title: course.course_title,
    p_exam_year: course.exam_year,
    p_notes: course.notes,
    p_question_file_name: file.name,
    p_storage_path: path,
  });

  if (result.error?.code === "PGRST202" || result.error?.code === "42883") {
    const legacyResult = await client
      .from("contributions")
      .insert({
        user_id: userId,
        name: contributor.name,
        email: contributor.email,
        university: course.university,
        course_code: course.course_code,
        course_title: course.course_title,
        exam_year: course.exam_year,
        notes: course.notes,
        question_file_name: file.name,
        storage_path: path,
      })
      .select("id, course_code, course_title, exam_year, status, created_at")
      .single();
    if (legacyResult.error) throw legacyResult.error;
    return legacyResult.data as Contribution;
  }
  if (result.error) throw result.error;

  const contribution = result.data as Contribution & { storage_path?: string };
  if (contribution.storage_path && contribution.storage_path !== path) {
    const { error: cleanupError } = await client.storage.from("contributions").remove([path]);
    if (cleanupError)
      console.error("Could not remove the duplicate contribution file.", cleanupError);
  }
  return contribution;
}

export async function createSuggestion(
  userId: string,
  contributor: { name: string; email: string },
  category: string,
  context: string,
  suggestion: string,
) {
  const { error } = await requireSupabase().from("suggestions").insert({
    user_id: userId,
    name: contributor.name,
    email: contributor.email,
    category,
    context,
    suggestion,
  });
  if (error) throw error;
}

export async function getAdminAccess() {
  const client = requireSupabase();
  const { error: acceptanceError } = await client.rpc("admin_accept_invitation");
  if (acceptanceError) throw acceptanceError;
  const { data, error } = await client.rpc("admin_get_access");
  if (error) throw error;
  return data as AdminAccess | null;
}

export async function getAdminOverview() {
  const { data, error } = await requireSupabase().rpc("admin_get_overview");
  if (error) throw error;
  return data as AdminOverview;
}

export async function getAdminContributions() {
  const { data, error } = await requireSupabase().rpc("admin_list_contributions");
  if (error) throw error;
  return (data ?? []) as AdminContribution[];
}

export async function reviewAdminContribution(
  contributionId: string,
  decision: "approved" | "rejected",
  reason: string | null,
) {
  const { error } = await requireSupabase().rpc("admin_review_contribution", {
    p_contribution_id: contributionId,
    p_decision: decision,
    p_reason: reason,
  });
  if (error) throw error;
}

export async function getAdminAuditLogs() {
  const { data, error } = await requireSupabase().rpc("admin_list_audit_logs", { p_limit: 100 });
  if (error) throw error;
  return (data ?? []) as AdminAuditLog[];
}

export async function getAdminContributionUrl(path: string) {
  const { data, error } = await requireSupabase()
    .storage.from("contributions")
    .createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function inviteAdmin(email: string, role: AdminAccess["role"]) {
  const client = requireSupabase();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Sign in again before sending a team invitation.");

  let response: Response;
  try {
    response = await fetch("/api/admin-invite", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, role }),
    });
  } catch {
    throw new Error("The invitation service could not be reached. Refresh and try again.");
  }

  const result = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string" ? result.error : "Could not invite this team member.",
    );
  }
}

export async function getAdminTeam() {
  const { data, error } = await requireSupabase().rpc("admin_list_team");
  if (error) throw error;
  return (data ?? []) as AdminTeamMember[];
}

export async function updateAdminTeamMember(
  userId: string,
  role: AdminAccess["role"],
  status: AdminTeamMember["status"],
) {
  const { error } = await requireSupabase().rpc("admin_update_team_member", {
    p_user_id: userId,
    p_role_id: role,
    p_status: status,
  });
  if (error) throw error;
}

export async function getAdminStudents(search: string) {
  const { data, error } = await requireSupabase().rpc("admin_list_students", {
    p_search: search,
  });
  if (error) {
    if (["PGRST202", "PGRST204", "42883", "42P01", "42703", "42804"].includes(error.code ?? "")) {
      throw new Error(
        "Student management SQL is missing or outdated. Apply supabase/admin-management.sql again, then reload the admin page.",
      );
    }
    if (error.code === "42501") {
      throw new Error("Your admin role does not have permission to manage student accounts.");
    }
    throw error;
  }
  return (data ?? []) as AdminStudent[];
}

export async function setAdminStudentSuspension(userId: string, suspended: boolean) {
  const { data, error } = await requireSupabase().functions.invoke("admin-student-access", {
    body: { userId, suspended },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}

export async function getAdminPapers() {
  const { data, error } = await requireSupabase().rpc("admin_list_papers");
  if (error) throw error;
  return (data ?? []) as AdminPaper[];
}

export async function publishAdminPaper(
  metadata: {
    university: string;
    courseCode: string;
    courseTitle: string;
    level: string;
    semester: string;
    academicSession: string;
    examYear: number;
  },
  file: File,
) {
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error("Sign in again before uploading a paper.");

  const filePath = `${userData.user.id}/admin/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadError } = await client.storage.from("contributions").upload(filePath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) throw uploadError;

  const { data, error } = await client.rpc("admin_publish_paper", {
    p_university: metadata.university,
    p_course_code: metadata.courseCode,
    p_course_title: metadata.courseTitle,
    p_level: metadata.level || null,
    p_semester: metadata.semester || null,
    p_academic_session: metadata.academicSession,
    p_exam_year: metadata.examYear,
    p_file_path: filePath,
  });
  if (error) {
    const { error: cleanupError } = await client.storage.from("contributions").remove([filePath]);
    if (cleanupError) console.error("Could not remove the unlinked admin paper.", cleanupError);
    throw error;
  }
  return data as string;
}

export async function deleteAdminPaper(paperId: string) {
  const { error } = await requireSupabase().rpc("admin_delete_paper", { p_paper_id: paperId });
  if (error) throw error;
}

export async function saveAdminUniversity(id: string | null, name: string, active: boolean) {
  const { error } = await requireSupabase().rpc("admin_save_university", {
    p_id: id,
    p_name: name,
    p_active: active,
  });
  if (error) throw error;
}

export async function getAdminUniversities() {
  const { data, error } = await requireSupabase().rpc("admin_list_universities");
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string; is_active?: boolean }>;
}

export async function getMaintenanceStatus() {
  const { data, error } = await requireSupabase().rpc("get_maintenance_status");
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "Maintenance controls are not installed yet. Run supabase/maintenance-mode.sql in the SQL Editor.",
      );
    }
    throw error;
  }
  if (!data) throw new Error("The maintenance status could not be read.");
  return data as MaintenanceStatus;
}

export async function setMaintenanceStatus(input: {
  active: boolean;
  endsAt: string | null;
  title: string;
  message: string;
}) {
  const { data, error } = await requireSupabase().rpc("set_maintenance_status", {
    p_active: input.active,
    p_ends_at: input.endsAt,
    p_title: input.title,
    p_message: input.message,
  });
  if (error) {
    if (error.code === "42501") {
      throw new Error("Only an active Super Admin can change maintenance mode.");
    }
    throw error;
  }
  return data as MaintenanceStatus;
}
