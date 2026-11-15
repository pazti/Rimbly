import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AppNotification,
  AdminAccess,
  AdminAuditLog,
  AdminContribution,
  archiveAdminQuizSet,
  AdminQuizPaper,
  AdminQuizSet,
  AdminPaper,
  AdminOverview,
  AdminStudent,
  AdminTeamMember,
  MaintenanceStatus,
  Contribution,
  Battle,
  Course,
  Leader,
  Paper,
  Profile,
  PublicQuestion,
  QuizQuestionReviewStatus,
  QuizAttempt,
  QuizSet,
  University,
  createAdminQuizRevision,
  createContribution,
  createSuggestion,
  getContributions,
  getCourses,
  getAdminQuizDraft,
  getAdminAccess,
  getAdminAuditLogs,
  getAdminContributions,
  getAdminContributionUrl,
  getAdminPapers,
  getAdminQuizPapers,
  getAdminQuizSets,
  getAdminStudents,
  getAdminTeam,
  getAdminUniversities,
  getAdminOverview,
  getMaintenanceStatus,
  deleteAdminPaper,
  inviteAdmin,
  publishAdminPaper,
  saveAdminQuizDraft,
  requestAdminQuizReview,
  reviewAdminQuiz,
  saveAdminUniversity,
  setMaintenanceStatus,
  setAdminStudentSuspension,
  updateAdminTeamMember,
  getLeaderboard,
  getNotifications,
  getPapers,
  getPaperReaderUrl,
  extractAdminQuizQuestions,
  getProfile,
  getPublishedQuizSets,
  getQuizSetQuestions,
  submitQuizSet,
  getBattleOpponents,
  createBattle,
  getBattles,
  respondToBattle,
  cancelBattle,
  getBattleQuestions,
  submitBattle,
  getUniversities,
  getQuizAttempts,
  getSavedCourseIds,
  markNotificationsRead,
  saveProfile,
  reviewAdminContribution,
  toggleSavedCourse,
} from "./lib/data";
import { supabase, supabaseConfigurationError } from "./lib/supabase";

type Route =
  | "welcome"
  | "signup"
  | "login"
  | "verify-email"
  | "reset-password"
  | "onboarding"
  | "home"
  | "practice"
  | "course"
  | "paper"
  | "quiz-setup"
  | "quiz"
  | "results"
  | "quiz-history"
  | "battle"
  | "leaderboard"
  | "profile"
  | "contribute"
  | "suggest"
  | "notifications"
  | "admin";

type PaperQuizAvailability = {
  paperId: string;
  status: "loading" | "ready" | "missing" | "error";
  quizId: string | null;
};

const routes: Route[] = [
  "welcome",
  "signup",
  "login",
  "verify-email",
  "reset-password",
  "onboarding",
  "home",
  "practice",
  "course",
  "paper",
  "quiz-setup",
  "quiz",
  "results",
  "quiz-history",
  "battle",
  "leaderboard",
  "profile",
  "contribute",
  "suggest",
  "notifications",
  "admin",
];

const routeFromLocation = (): Route => {
  const queryRoute = new URLSearchParams(window.location.search).get("route");
  if (routes.includes(queryRoute as Route)) return queryRoute as Route;

  const hashRoute = window.location.hash.replace(/^#\/?/, "");
  return routes.includes(hashRoute as Route) ? (hashRoute as Route) : "welcome";
};

const routeUrl = (route: Route) => `${window.location.origin}/?route=${encodeURIComponent(route)}`;

const adminQuestionPrompt = `Read the attached past-paper PDF and draft faithful multiple-choice questions using only information visible in the source. Do not invent wording, options, answers, or page references. Skip anything unclear rather than guessing.

Return JSON only, with no Markdown fences, using this shape:
{
  "questions": [
    {
      "prompt": "Question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_index": 0,
      "explanation": "Brief explanation only when supported by the source; otherwise an empty string.",
      "source_page": 1,
      "source_note": "Short source reference, or an empty string."
    }
  ]
}

Requirements:
- Include only clearly legible multiple-choice questions, each with 2–6 non-empty options.
- Preserve the original question meaning, symbols, units, and option order.
- Use a zero-based correct_index only when the paper or answer key clearly confirms it; otherwise use null.
- source_page must be the printed/original page number when identifiable, otherwise null.
- Keep explanations and source notes concise. Never infer an answer from outside knowledge.
- Return {"questions": []} if no reliable questions can be extracted.`;

const getErrorMessage = (value: unknown, fallback: string) => {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
};

const parseAdminRole = (value: string): AdminAccess["role"] | null =>
  value === "super_admin" || value === "admin" || value === "moderator" ? value : null;

const toLocalDateTimeInput = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const navItems: { route: Route; label: string; icon: string }[] = [
  { route: "home", label: "Home", icon: "⌂" },
  { route: "practice", label: "Practice", icon: "▤" },
  { route: "battle", label: "Battle", icon: "⚔" },
  { route: "leaderboard", label: "Leaders", icon: "♜" },
  { route: "profile", label: "Profile", icon: "◉" },
];

function Icon({ children }: { children: string }) {
  return (
    <span className="rimbly-icon" aria-hidden="true">
      {children}
    </span>
  );
}

function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled = false,
  name,
  value,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  return (
    <button
      className={`btn btn-${variant}`}
      type={type}
      onClick={onClick}
      disabled={disabled}
      name={name}
      value={value}
    >
      {children}
    </button>
  );
}

function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button className="logo" onClick={onClick} aria-label="Rimbly home">
      <span className="logo-mark" aria-hidden="true">
        <img
          src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/colour%20icon%20preview-U3JEroXylKhRU0xn7PCPxbARnG2r4D.png"
          alt=""
        />
      </span>
      <span>Rimbly</span>
    </button>
  );
}

function Feedback({ error, clear }: { error: string | null; clear: () => void }) {
  if (!error) return null;
  return (
    <div className="app-feedback" role="alert">
      <span>{error}</span>
      <button type="button" onClick={clear} aria-label="Dismiss message">
        ×
      </button>
    </div>
  );
}

function EmptyState({
  title,
  text,
  action,
  onAction,
}: {
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-card">
      <span className="empty-card-icon">⌁</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && onAction && (
        <Button variant="secondary" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

function AppShell({
  route,
  title,
  adminAvailable,
  onNavigate,
  children,
}: {
  route: Route;
  title: string;
  adminAvailable: boolean;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <Logo onClick={() => onNavigate("home")} />
        <nav aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.route}
              className={route === item.route ? "active" : ""}
              onClick={() => onNavigate(item.route)}
            >
              <Icon>{item.icon}</Icon>
              {item.label}
            </button>
          ))}
          {adminAvailable && (
            <button
              className={route === "admin" ? "active" : ""}
              onClick={() => onNavigate("admin")}
            >
              <Icon>⚙</Icon>
              Admin workspace
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => onNavigate("contribute")}>
            <Icon>↑</Icon>Contribute
          </button>
        </div>
      </aside>
      <div className="app-column">
        <header className="app-topbar">
          <div className="topbar-inner">
            <Logo onClick={() => onNavigate("home")} />
            <strong className="mobile-page-title">{title}</strong>
            <button
              className="icon-btn notification-btn"
              onClick={() => onNavigate("notifications")}
              aria-label="Notifications"
            >
              <Icon>♧</Icon>
            </button>
          </div>
        </header>
        <main className="app-main">{children}</main>
        <nav className="bottom-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.route}
              className={route === item.route ? "active" : ""}
              onClick={() => onNavigate(item.route)}
            >
              <Icon>{item.icon}</Icon>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

function AuthPage({
  mode,
  busy,
  error,
  onSubmit,
  onOAuth,
  onReset,
  onNavigate,
  onClearError,
  configured,
}: {
  mode: "signup" | "login";
  busy: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOAuth: () => void;
  onReset: (email: string) => void;
  onNavigate: (route: Route) => void;
  onClearError: () => void;
  configured: boolean;
}) {
  const login = mode === "login";
  const [email, setEmail] = useState("");
  return (
    <div className="auth-form-page">
      <div className="auth-form-wrap">
        <div className="auth-form-head">
          <Logo onClick={() => onNavigate("welcome")} />
          <button type="button" onClick={() => onNavigate("welcome")} aria-label="Close">
            ×
          </button>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">{login ? "Welcome back" : "Join the climb"}</span>
          <h1>{login ? "Good to see you." : "Create your account."}</h1>
          <p>
            {login
              ? "Sign in to continue where you left off."
              : "Your next best score starts with one small step."}
          </p>
        </div>
        <Feedback error={error} clear={onClearError} />
        <button
          className="google-btn"
          type="button"
          onClick={onOAuth}
          disabled={busy || !configured}
        >
          <b>G</b>Continue with Google
        </button>
        <div className="or">
          <span />
          or continue with email
          <span />
        </div>
        <form onSubmit={onSubmit} className="form-stack">
          {!login && (
            <label>
              <span>Full name</span>
              <input name="full_name" required autoComplete="name" />
            </label>
          )}
          <label>
            <span>Email address</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={login ? "current-password" : "new-password"}
            />
          </label>
          {login && (
            <button
              className="forgot"
              type="button"
              onClick={() => onReset(email)}
              disabled={!email || !configured || busy}
            >
              Forgot password?
            </button>
          )}
          <Button type="submit" disabled={busy || !configured}>
            {busy ? "Please wait…" : login ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="auth-switch">
          {login ? "New to Rimbly?" : "Already have an account?"}{" "}
          <button type="button" onClick={() => onNavigate(login ? "signup" : "login")}>
            {login ? "Create account" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}

function PasswordResetPage({
  busy,
  onSubmit,
  onNavigate,
}: {
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onNavigate: (route: Route) => void;
}) {
  return (
    <div className="auth-form-page">
      <div className="auth-form-wrap">
        <div className="auth-form-head">
          <Logo onClick={() => onNavigate("welcome")} />
        </div>
        <div className="auth-copy">
          <span className="eyebrow">Reset password</span>
          <h1>Choose a new password.</h1>
          <p>Use at least eight characters to secure your account.</p>
        </div>
        <form className="form-stack" onSubmit={onSubmit}>
          <label>
            <span>New password</span>
            <input
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
            />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function VerifyEmailPage({
  email,
  busy,
  error,
  notice,
  onResend,
  onNavigate,
  onClearError,
}: {
  email: string;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onResend: () => void;
  onNavigate: (route: Route) => void;
  onClearError: () => void;
}) {
  return (
    <div className="auth-form-page">
      <div className="auth-form-wrap verification-card">
        <div className="auth-form-head">
          <Logo onClick={() => onNavigate("welcome")} />
        </div>
        <div className="verification-icon" aria-hidden="true">
          ✉
        </div>
        <div className="auth-copy">
          <span className="eyebrow">One more step</span>
          <h1>Check your inbox.</h1>
          <p>
            We sent a confirmation link to <strong>{email || "your email address"}</strong>. Open it
            to verify your email and activate your account.
          </p>
          <p className="verification-help">
            If you don’t see it, check your spam folder. The confirmation link may expire.
          </p>
        </div>
        <Feedback error={error} clear={onClearError} />
        {notice && (
          <p className="app-notice" role="status">
            {notice}
          </p>
        )}
        <Button onClick={onResend} disabled={busy || !email}>
          {busy ? "Sending…" : "Resend confirmation email"}
        </Button>
        <p className="auth-switch">
          Already confirmed?{" "}
          <button type="button" onClick={() => onNavigate("login")}>
            Sign in
          </button>
        </p>
        <button
          className="btn btn-secondary verification-back"
          type="button"
          onClick={() => onNavigate("signup")}
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}

function MaintenancePage({
  status,
  signedIn,
  onAdminSignIn,
}: {
  status: MaintenanceStatus | null;
  signedIn: boolean;
  onAdminSignIn: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const endTime = status?.ends_at ? new Date(status.ends_at).getTime() : null;
  const remaining = endTime ? Math.max(0, endTime - now) : 0;
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining / 3_600_000) % 24);
  const minutes = Math.floor((remaining / 60_000) % 60);
  const seconds = Math.floor((remaining / 1000) % 60);

  return (
    <main className="maintenance-page">
      <div className="maintenance-orb maintenance-orb-one" aria-hidden="true" />
      <div className="maintenance-orb maintenance-orb-two" aria-hidden="true" />
      <section className="maintenance-card" aria-labelledby="maintenance-title">
        <div className="logo maintenance-logo" aria-label="Rimbly">
          <span className="logo-mark" aria-hidden="true">
            <img
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/colour%20icon%20preview-U3JEroXylKhRU0xn7PCPxbARnG2r4D.png"
              alt=""
            />
          </span>
          <span>Rimbly</span>
        </div>
        <div className="maintenance-art" aria-hidden="true">
          <div className="maintenance-sun" />
          <div className="maintenance-hill maintenance-hill-back" />
          <div className="maintenance-hill maintenance-hill-front" />
          <div className="maintenance-tool">✦</div>
          <div className="maintenance-star maintenance-star-one">✦</div>
          <div className="maintenance-star maintenance-star-two">✧</div>
        </div>
        <span className="maintenance-label">
          <span className="maintenance-live-dot" />
          A LITTLE SITE MAINTENANCE
        </span>
        <h1 id="maintenance-title">{status?.title || "We’ll be back soon"}</h1>
        <p className="maintenance-message">
          {status?.message || "We’re making Rimbly better. Your account and progress are safe."}
        </p>
        {endTime && remaining > 0 ? (
          <>
            <div className="maintenance-countdown" aria-label="Time remaining">
              {[
                [days, "days"],
                [hours, "hours"],
                [minutes, "minutes"],
                [seconds, "seconds"],
              ].map(([value, unit]) => (
                <div className="maintenance-time" key={unit}>
                  <strong>{String(value).padStart(2, "0")}</strong>
                  <span>{unit}</span>
                </div>
              ))}
            </div>
            <p className="maintenance-end-time">
              Expected back{" "}
              {new Date(endTime).toLocaleString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          </>
        ) : (
          <div className="maintenance-updating" role="status">
            <span className="loading-spinner" aria-hidden="true" />
            <span>We’re putting the finishing touches on things.</span>
          </div>
        )}
        <div className="maintenance-footer">
          <span>Your account and saved progress are safe.</span>
          <button type="button" className="maintenance-admin-link" onClick={onAdminSignIn}>
            {signedIn ? "Switch to Super Admin" : "Super Admin sign in"}{" "}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
    </main>
  );
}

function CourseCard({
  course,
  paperCount,
  onClick,
}: {
  course: Course;
  paperCount: number;
  onClick: () => void;
}) {
  return (
    <button className="course-card" onClick={onClick}>
      <span className="course-icon tone-purple">
        <Icon>▤</Icon>
      </span>
      <span className="course-copy">
        <span className="course-tags">
          {course.department && <span className="badge">{course.department}</span>}
          <span className="badge badge-purple">{course.university}</span>
        </span>
        <strong>{course.code}</strong>
        <small>{course.title}</small>
        <em>
          {paperCount} {paperCount === 1 ? "paper" : "papers"} available
        </em>
      </span>
      <span aria-hidden="true">›</span>
    </button>
  );
}

const normalizeCatalogLabel = (value: string | null | undefined) =>
  value?.trim().toLocaleLowerCase() ?? "";

function studyRelevance(
  department: string | null | undefined,
  university: string | null | undefined,
  profile: Profile | null,
) {
  const departmentMatch = Boolean(
    normalizeCatalogLabel(department) &&
    normalizeCatalogLabel(department) === normalizeCatalogLabel(profile?.department),
  );
  const universityMatch = Boolean(
    normalizeCatalogLabel(university) &&
    normalizeCatalogLabel(university) === normalizeCatalogLabel(profile?.university),
  );
  if (departmentMatch && universityMatch) return 0;
  if (departmentMatch) return 1;
  if (universityMatch) return 2;
  return 3;
}

function sortCoursesForProfile(courses: Course[], profile: Profile | null) {
  return [...courses].sort(
    (first, second) =>
      studyRelevance(first.department, first.university, profile) -
        studyRelevance(second.department, second.university, profile) ||
      first.university.localeCompare(second.university) ||
      first.code.localeCompare(second.code),
  );
}

function sortQuizSetsForProfile(quizzes: QuizSet[], profile: Profile | null) {
  const priority = (quiz: QuizSet) => {
    const departmentMatch = [quiz.audience_department, quiz.course_department].some(
      (label) =>
        normalizeCatalogLabel(label) &&
        normalizeCatalogLabel(label) === normalizeCatalogLabel(profile?.department),
    );
    const universityMatch = [quiz.audience_university, quiz.university].some(
      (label) =>
        normalizeCatalogLabel(label) &&
        normalizeCatalogLabel(label) === normalizeCatalogLabel(profile?.university),
    );
    if (departmentMatch && universityMatch) return 0;
    if (departmentMatch) return 1;
    if (universityMatch) return 2;
    return 3;
  };

  return [...quizzes].sort(
    (first, second) =>
      priority(first) - priority(second) || second.created_at.localeCompare(first.created_at),
  );
}

function QuizCatalogCard({
  quiz,
  busy,
  onTake,
  onReadSource,
}: {
  quiz: QuizSet;
  busy: boolean;
  onTake: () => void;
  onReadSource: () => void;
}) {
  const departments = [
    ...new Set([quiz.audience_department, quiz.course_department].filter(Boolean)),
  ];
  const universities = [...new Set([quiz.audience_university, quiz.university].filter(Boolean))];
  const courseLabel = [quiz.course_code, quiz.course_title].filter(Boolean).join(" · ");

  return (
    <article className="quiz-catalog-card">
      <div>
        <h2>{quiz.title}</h2>
        <p>{quiz.description || "Reviewed practice questions"}</p>
        <small>
          {courseLabel ? `Course: ${courseLabel} · ` : ""}
          {quiz.question_count} questions
        </small>
        <small className="quiz-audience-meta">
          Department: {departments.join(" / ") || "General"} · University:{" "}
          {universities.join(" / ") || "All universities"}
        </small>
        {quiz.source_file_path && (
          <button type="button" className="quiz-source-link" onClick={onReadSource}>
            Read source in viewer: {quiz.source_file_name ?? "Source paper"}
          </button>
        )}
      </div>
      <Button disabled={busy} onClick={onTake}>
        {busy ? "Loading…" : "Take quiz"}
      </Button>
    </article>
  );
}

function App() {
  const [route, setRoute] = useState<Route>(routeFromLocation);
  const [verificationEmail, setVerificationEmail] = useState(
    () => window.sessionStorage.getItem("rimbly-verification-email") ?? "",
  );
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [maintenanceStatus, setMaintenanceStatusState] = useState<MaintenanceStatus | null>(null);
  const [maintenanceStatusLoaded, setMaintenanceStatusLoaded] = useState(false);
  const [maintenanceStatusError, setMaintenanceStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [adminAccess, setAdminAccess] = useState<AdminAccess | null>(null);
  const [adminAccessLoaded, setAdminAccessLoaded] = useState(false);
  const [adminAccessError, setAdminAccessError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(supabaseConfigurationError);
  const [notice, setNotice] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [universities, setUniversities] = useState<University[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [savedCourseIds, setSavedCourseIds] = useState<string[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [lastAttempt, setLastAttempt] = useState<QuizAttempt | null>(null);
  const [paperQuizAvailability, setPaperQuizAvailability] = useState<PaperQuizAvailability | null>(
    null,
  );
  const [publishedQuizSets, setPublishedQuizSets] = useState<QuizSet[]>([]);
  const [publishedQuizSetsLoading, setPublishedQuizSetsLoading] = useState(true);
  const [activeQuizSetId, setActiveQuizSetId] = useState<string | null>(null);
  const [sourceToRead, setSourceToRead] = useState<{ path: string; title: string } | null>(null);
  const [leaderboardScope, setLeaderboardScope] = useState<"university" | "all">("university");

  const user = session?.user ?? null;
  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  const selectedPaper = papers.find((paper) => paper.id === selectedPaperId) ?? null;
  const prioritizedCourses = useMemo(
    () => sortCoursesForProfile(courses, profile),
    [courses, profile],
  );
  const prioritizedQuizSets = useMemo(
    () => sortQuizSetsForProfile(publishedQuizSets, profile),
    [publishedQuizSets, profile],
  );

  const navigate = (next: Route) => {
    setError(null);
    setNotice(null);
    window.history.pushState({ route: next }, "", routeUrl(next));
    setRoute(next);
  };

  const refreshPublishedQuizSets = async (reportEmpty = false) => {
    setPublishedQuizSetsLoading(true);
    setError(null);
    if (reportEmpty) setNotice(null);
    try {
      const refreshedQuizzes = await getPublishedQuizSets();
      setPublishedQuizSets(refreshedQuizzes);
      if (reportEmpty && !refreshedQuizzes.length) {
        setNotice(
          "No quizzes were returned. Confirm a reviewer published the set with at least one approved question and answer key; this list does not filter by department.",
        );
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load published quizzes.",
      );
    } finally {
      setPublishedQuizSetsLoading(false);
    }
  };

  useEffect(() => {
    const updateRoute = () => setRoute(routeFromLocation());
    window.addEventListener("popstate", updateRoute);

    if (!supabase) {
      setAuthReady(true);
      return () => window.removeEventListener("popstate", updateRoute);
    }

    let active = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") {
        navigate("reset-password");
      }
      if (!nextSession) {
        setProfile(null);
        setCourses([]);
        setPapers([]);
        setAttempts([]);
        setLeaders([]);
        setNotifications([]);
        setContributions([]);
        setSavedCourseIds([]);
        navigate("welcome");
      }
      setAuthReady(true);
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setAuthReady(true);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      window.removeEventListener("popstate", updateRoute);
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      setMaintenanceStatusError(
        supabaseConfigurationError ?? "The maintenance status service is unavailable.",
      );
      setMaintenanceStatusLoaded(true);
      return;
    }

    let active = true;
    const refreshStatus = async () => {
      try {
        const status = await getMaintenanceStatus();
        if (!active) return;
        setMaintenanceStatusState(status);
        setMaintenanceStatusError(null);
      } catch (statusError) {
        if (!active) return;
        setMaintenanceStatusError(
          statusError instanceof Error
            ? statusError.message
            : "Could not check whether the website is under maintenance.",
        );
      } finally {
        if (active) setMaintenanceStatusLoaded(true);
      }
    };

    void refreshStatus();
    const interval = window.setInterval(() => void refreshStatus(), 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const publicRoutes: Route[] = ["welcome", "signup", "login", "verify-email", "reset-password"];
    if (user && publicRoutes.includes(route) && route !== "reset-password")
      navigate(profile ? "home" : "onboarding");
    else if (!user && !publicRoutes.includes(route)) navigate("welcome");
  }, [authReady, user, profile, route]);

  useEffect(() => {
    if (!user || !supabase) return;
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      getProfile(user.id),
      getUniversities(),
      getCourses(),
      getPapers(),
      getQuizAttempts(user.id),
      getLeaderboard(),
      getNotifications(user.id),
      getContributions(user.id),
      getSavedCourseIds(user.id),
    ])
      .then(
        ([
          nextProfile,
          nextUniversities,
          nextCourses,
          nextPapers,
          nextAttempts,
          nextLeaders,
          nextNotifications,
          nextContributions,
          nextSaved,
        ]) => {
          if (!active) return;
          setProfile(nextProfile);
          setUniversities(nextUniversities);
          setCourses(nextCourses);
          setPapers(nextPapers);
          setAttempts(nextAttempts);
          setLastAttempt(nextAttempts[0] ?? null);
          setLeaders(nextLeaders);
          setNotifications(nextNotifications);
          setContributions(nextContributions);
          setSavedCourseIds(nextSaved);
          if (
            route === "welcome" ||
            route === "signup" ||
            route === "login" ||
            route === "verify-email"
          ) {
            navigate(nextProfile?.university && nextProfile.level ? "home" : "onboarding");
          }
        },
      )
      .catch((loadError: unknown) => {
        if (active)
          setError(
            loadError instanceof Error ? loadError.message : "Could not load your account data.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user || !["quiz-setup", "paper", "profile"].includes(route)) return;
    let active = true;
    setPublishedQuizSetsLoading(true);
    void getPublishedQuizSets()
      .then((result) => {
        if (active) setPublishedQuizSets(result);
      })
      .catch((loadError: unknown) => {
        if (active)
          setError(
            loadError instanceof Error ? loadError.message : "Could not load published quizzes.",
          );
      })
      .finally(() => {
        if (active) setPublishedQuizSetsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [route, user?.id]);

  useEffect(() => {
    if (!user || !profile || route !== "leaderboard") return;
    let active = true;
    void getLeaderboard(leaderboardScope === "university" ? profile.university : null)
      .then((result) => {
        if (active) setLeaders(result);
      })
      .catch((loadError: unknown) => {
        if (active)
          setError(loadError instanceof Error ? loadError.message : "Could not load rankings.");
      });
    return () => {
      active = false;
    };
  }, [leaderboardScope, profile?.university, route, user?.id]);

  useEffect(() => {
    if (route !== "paper" || !selectedPaper) {
      setPaperQuizAvailability(null);
      return;
    }

    let active = true;
    setPaperQuizAvailability({ paperId: selectedPaper.id, status: "loading", quizId: null });
    void getPublishedQuizSets()
      .then((quizSets) => {
        if (active) {
          setPublishedQuizSets(quizSets);
          const linkedQuiz = quizSets.find((quiz) => quiz.paper_id === selectedPaper.id);
          setPaperQuizAvailability({
            paperId: selectedPaper.id,
            status: linkedQuiz ? "ready" : "missing",
            quizId: linkedQuiz?.id ?? null,
          });
        }
      })
      .catch((availabilityError: unknown) => {
        if (!active) return;
        setPaperQuizAvailability({ paperId: selectedPaper.id, status: "error", quizId: null });
        setError(
          availabilityError instanceof Error
            ? availabilityError.message
            : "Could not check for a quiz on this paper.",
        );
      });

    return () => {
      active = false;
    };
  }, [route, selectedPaper?.id]);

  useEffect(() => {
    let active = true;
    setAdminAccess(null);
    setAdminAccessError(null);
    if (!user || !supabase) {
      setAdminAccessLoaded(true);
      return () => {
        active = false;
      };
    }

    setAdminAccessLoaded(false);
    void getAdminAccess()
      .then((access) => {
        if (active) setAdminAccess(access);
      })
      .catch((accessError: unknown) => {
        if (active) {
          setAdminAccessError(
            accessError instanceof Error ? accessError.message : "Could not check admin access.",
          );
        }
      })
      .finally(() => {
        if (active) setAdminAccessLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  const refreshActivity = async () => {
    if (!user) return;
    const [nextAttempts, nextLeaders, nextNotifications, nextContributions] = await Promise.all([
      getQuizAttempts(user.id),
      getLeaderboard(),
      getNotifications(user.id),
      getContributions(user.id),
    ]);
    setAttempts(nextAttempts);
    setLastAttempt(nextAttempts[0] ?? null);
    setLeaders(nextLeaders);
    setNotifications(nextNotifications);
    setContributions(nextContributions);
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>, mode: "signup" | "login") => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    try {
      if (mode === "signup") {
        const fullName = String(form.get("full_name") ?? "").trim();
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: routeUrl("onboarding"),
          },
        });
        if (authError) throw authError;
        if (!data.session) {
          window.sessionStorage.setItem("rimbly-verification-email", email);
          setVerificationEmail(email);
          navigate("verify-email");
          return;
        }
        window.sessionStorage.removeItem("rimbly-verification-email");
        setVerificationEmail("");
        navigate("onboarding");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        window.sessionStorage.removeItem("rimbly-verification-email");
        setVerificationEmail("");
        navigate("home");
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    if (!supabase || !verificationEmail) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: verificationEmail,
        options: { emailRedirectTo: routeUrl("onboarding") },
      });
      if (resendError) throw resendError;
      setNotice("A new confirmation link has been sent. Check your inbox and spam folder.");
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : "Could not resend the confirmation email.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: routeUrl("onboarding") },
    });
    if (authError) {
      setError(authError.message);
      setBusy(false);
    }
  };

  const handleResetPassword = async (email: string) => {
    if (!supabase || !email) return;
    setBusy(true);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: routeUrl("reset-password"),
      });
      if (resetError) throw resetError;
      setNotice("If an account exists for that email, a password reset link is on its way.");
    } catch (resetError) {
      setError(
        resetError instanceof Error ? resetError.message : "Could not request a password reset.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUpdatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: String(form.get("password") ?? ""),
      });
      if (updateError) throw updateError;
      setNotice("Your password has been updated.");
      navigate("home");
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "Could not update your password.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const saved = await saveProfile(user, {
        full_name: String(form.get("full_name") ?? "").trim(),
        university: String(form.get("university") ?? "").trim(),
        faculty: String(form.get("faculty") ?? "").trim() || null,
        department: String(form.get("department") ?? "").trim() || null,
        level: String(form.get("level") ?? "").trim(),
      });
      setProfile(saved);
      setNotice("Your profile was saved.");
      navigate(route === "onboarding" ? "home" : "profile");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleSaved = async (courseId: string) => {
    if (!user) return;
    const isSaved = savedCourseIds.includes(courseId);
    setBusy(true);
    setError(null);
    try {
      await toggleSavedCourse(user.id, courseId, isSaved);
      setSavedCourseIds((current) =>
        isSaved ? current.filter((id) => id !== courseId) : [...current, courseId],
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update saved courses.");
    } finally {
      setBusy(false);
    }
  };

  const handleStartQuiz = async (quizId?: string) => {
    if (!quizId) {
      setError("Choose a quiz with approved structured questions.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nextQuestions = await getQuizSetQuestions(quizId);
      if (!nextQuestions.length) {
        setError("This quiz has no approved questions yet.");
        return;
      }
      const quizSet = publishedQuizSets.find((item) => item.id === quizId);
      const quizPaper = quizSet?.paper_id
        ? papers.find((paper) => paper.id === quizSet.paper_id)
        : null;
      setSelectedPaperId(quizPaper?.id ?? null);
      setSelectedCourseId(quizPaper?.course_id ?? null);
      setActiveQuizSetId(quizId);
      setQuestions(nextQuestions);
      setAnswers({});
      setLastAttempt(null);
      setQuizStartedAt(Date.now());
      navigate("quiz");
    } catch (questionError) {
      setError(
        questionError instanceof Error ? questionError.message : "Could not load quiz questions.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitQuiz = async () => {
    if (!activeQuizSetId || !user) return;
    setBusy(true);
    setError(null);
    try {
      const duration = Math.max(0, Math.floor((Date.now() - quizStartedAt) / 1000));
      const attempt = await submitQuizSet(activeQuizSetId, answers, duration);
      setLastAttempt({
        ...attempt,
        points_earned: attempt.points_earned ?? attempt.correct_count * 10,
      });
      navigate("results");
      try {
        await refreshActivity();
      } catch (refreshError) {
        setError(
          `Your quiz was saved, but the activity summary could not refresh: ${refreshError instanceof Error ? refreshError.message : "unknown error"}`,
        );
      }
    } catch (quizError) {
      setError(quizError instanceof Error ? quizError.message : "Could not save your quiz.");
    } finally {
      setBusy(false);
    }
  };

  const [quizStartedAt, setQuizStartedAt] = useState(Date.now());
  const startQuiz = async (quizId?: string) => {
    await handleStartQuiz(quizId);
  };

  const handleContribution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a PDF or image to upload.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("The file must be 20 MB or smaller.");
      return;
    }
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
      setError("Upload a PDF, JPG, or PNG file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createContribution(
        user.id,
        { name: profile?.full_name || user.user_metadata.full_name || "", email: user.email ?? "" },
        {
          university: String(data.get("university") ?? profile?.university ?? "").trim(),
          course_code: String(data.get("course_code") ?? "").trim(),
          course_title: String(data.get("course_title") ?? "").trim(),
          exam_year: Number(data.get("exam_year")),
          notes: String(data.get("notes") ?? "").trim(),
        },
        file,
      );
      form.reset();
      setNotice("Your contribution was submitted for review.");
      try {
        setContributions(await getContributions(user.id));
      } catch (refreshError) {
        setError(
          `Your contribution was saved, but the list could not refresh: ${refreshError instanceof Error ? refreshError.message : "unknown error"}`,
        );
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Could not submit your contribution.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSuggestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError(null);
    try {
      await createSuggestion(
        user.id,
        { name: profile?.full_name || user.user_metadata.full_name || "", email: user.email ?? "" },
        String(form.get("category") ?? ""),
        String(form.get("context") ?? "").trim(),
        String(form.get("suggestion") ?? "").trim(),
      );
      formElement.reset();
      setNotice("Thank you — your feedback was saved.");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Could not submit your feedback.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleMarkRead = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await markNotificationsRead(user.id);
      setNotifications((current) =>
        current.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })),
      );
    } catch (markError) {
      setError(
        markError instanceof Error ? markError.message : "Could not mark notifications as read.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setBusy(true);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
    setBusy(false);
  };

  const handleMaintenanceAdminSignIn = async () => {
    if (user && supabase) {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setError(signOutError.message);
        return;
      }
    }
    navigate("login");
  };

  const pageError = error;
  const configurationBanner = supabaseConfigurationError;

  if (!authReady || (route !== "login" && !maintenanceStatusLoaded)) {
    return (
      <div className="loading-screen" role="status">
        <span className="loading-spinner" aria-hidden="true" />
        <span>Connecting to Rimbly…</span>
      </div>
    );
  }

  const isSuperAdmin = adminAccess?.role === "super_admin";
  if (route !== "login" && maintenanceStatusError) {
    return (
      <div className="maintenance-error-page" role="alert">
        <span className="eyebrow">Website availability</span>
        <h1>We can’t check the site status.</h1>
        <p>{maintenanceStatusError}</p>
        <p>
          For safety, sign in as a Super Admin or try again after the maintenance setup is fixed.
        </p>
        <Button onClick={() => void handleMaintenanceAdminSignIn()}>
          {user ? "Switch account" : "Super Admin sign in"}
        </Button>
      </div>
    );
  }

  if (route !== "login" && maintenanceStatus?.active && user && !adminAccessLoaded) {
    return (
      <div className="loading-screen" role="status">
        <span className="loading-spinner" aria-hidden="true" />
        <span>Checking Super Admin access…</span>
      </div>
    );
  }

  if (route !== "login" && maintenanceStatus?.active && !isSuperAdmin) {
    return (
      <MaintenancePage
        status={maintenanceStatus}
        signedIn={Boolean(user)}
        onAdminSignIn={() => void handleMaintenanceAdminSignIn()}
      />
    );
  }

  if (user && loading && !courses.length && !profile) {
    return (
      <div className="loading-screen" role="status">
        <span className="loading-spinner" aria-hidden="true" />
        <span>Connecting to Rimbly…</span>
      </div>
    );
  }

  if (route === "admin" && !adminAccessLoaded) {
    return (
      <div className="loading-screen" role="status">
        <span className="loading-spinner" aria-hidden="true" />
        <span>Checking administrator access…</span>
      </div>
    );
  }

  if (route === "reset-password") {
    if (!user) {
      return (
        <div className="auth-form-page">
          <div className="auth-form-wrap">
            <h1>Password reset link expired.</h1>
            <p>Request a new link to continue.</p>
            <Feedback error={pageError} clear={() => setError(null)} />
            <Button onClick={() => navigate("login")}>Return to sign in</Button>
          </div>
        </div>
      );
    }
    return (
      <>
        <PasswordResetPage
          busy={busy}
          onSubmit={(event) => void handleUpdatePassword(event)}
          onNavigate={navigate}
        />
        <Feedback error={pageError} clear={() => setError(null)} />
      </>
    );
  }

  if (route === "verify-email") {
    return (
      <VerifyEmailPage
        email={verificationEmail}
        busy={busy}
        error={pageError}
        notice={notice}
        onResend={() => void handleResendVerification()}
        onNavigate={navigate}
        onClearError={() => setError(null)}
      />
    );
  }

  if (route === "welcome" || route === "signup" || route === "login") {
    if (route === "welcome") {
      return (
        <div className="auth-shell">
          <section className="auth-art">
            <Logo onClick={() => navigate("welcome")} />
            <div className="welcome-emblem">
              <span>✦</span>
              <i>R</i>
            </div>
            <div>
              <span className="badge badge-amber">Built for students</span>
              <h1>
                Practice.
                <br />
                Battle. <em>Climb.</em>
              </h1>
              <p>
                Real past questions and focused practice, powered by your university’s academic
                community.
              </p>
            </div>
          </section>
          <section className="auth-panel">
            <h2>
              Your academic edge
              <br />
              starts here.
            </h2>
            <p>Create an account to find published course papers and save your practice history.</p>
            {configurationBanner && (
              <p className="app-feedback" role="alert">
                {configurationBanner}
              </p>
            )}
            <Feedback error={configurationBanner ? null : pageError} clear={() => setError(null)} />
            {notice && (
              <p className="app-notice" role="status">
                {notice}
              </p>
            )}
            <Button disabled={!supabase} onClick={() => navigate("signup")}>
              Create free account →
            </Button>
            <Button variant="secondary" disabled={!supabase} onClick={() => navigate("login")}>
              I already have an account
            </Button>
            <small>Your courses and practice activity appear here as they are added.</small>
          </section>
        </div>
      );
    }
    return (
      <>
        <AuthPage
          mode={route}
          busy={busy}
          error={pageError}
          onSubmit={(event) => void handleAuth(event, route)}
          onOAuth={() => void handleGoogleAuth()}
          onReset={(email) => void handleResetPassword(email)}
          onNavigate={navigate}
          onClearError={() => setError(null)}
          configured={Boolean(supabase)}
        />
        {configurationBanner && (
          <div className="configuration-banner" role="alert">
            {configurationBanner}
          </div>
        )}
        {notice && (
          <div className="configuration-banner" role="status">
            {notice}
          </div>
        )}
      </>
    );
  }

  if (!user) {
    return (
      <div className="loading-screen" role="status">
        <span className="loading-spinner" aria-hidden="true" />
        <span>Taking you to sign in…</span>
      </div>
    );
  }

  if (route === "onboarding" || !profile) {
    return (
      <div className="onboarding-page">
        <header>
          <Logo onClick={() => navigate("welcome")} />
        </header>
        <main>
          <span className="eyebrow">Set up your profile</span>
          <h1>Make it yours.</h1>
          <p>Your profile is stored securely with your account.</p>
          <Feedback error={pageError} clear={() => setError(null)} />
          <form className="form-stack" onSubmit={(event) => void handleSaveProfile(event)}>
            <label>
              <span>Full name</span>
              <input
                name="full_name"
                required
                defaultValue={profile?.full_name || String(user.user_metadata.full_name ?? "")}
              />
            </label>
            <label>
              <span>University</span>
              <select
                name="university"
                required
                defaultValue={profile?.university ?? ""}
                disabled={!universities.length}
              >
                <option value="" disabled>
                  {universities.length
                    ? "Select your university"
                    : "Load the university directory first"}
                </option>
                {universities.map((university) => (
                  <option key={university.id} value={university.name}>
                    {university.name}
                  </option>
                ))}
              </select>
              {!universities.length && (
                <small className="field-note">
                  The university list is not available yet. Ask an administrator to finish setting
                  up the directory.
                </small>
              )}
            </label>
            <label>
              <span>Faculty (optional)</span>
              <input name="faculty" defaultValue={profile?.faculty ?? ""} />
            </label>
            <label>
              <span>Department (optional)</span>
              <input name="department" defaultValue={profile?.department ?? ""} />
            </label>
            <label>
              <span>Current level</span>
              <select name="level" required defaultValue={profile?.level ?? ""}>
                <option value="" disabled>
                  Select your level
                </option>
                {[
                  "100 Level",
                  "200 Level",
                  "300 Level",
                  "400 Level",
                  "500 Level",
                  "Postgraduate",
                ].map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save profile"}
            </Button>
          </form>
        </main>
      </div>
    );
  }

  if (route === "admin") {
    return (
      <AdminWorkspace
        access={adminAccess}
        accessError={adminAccessError}
        userId={user.id}
        profile={profile}
        universities={universities}
        maintenanceStatus={maintenanceStatus}
        onMaintenanceChange={setMaintenanceStatusState}
        onNavigate={navigate}
      />
    );
  }

  const matchingPapers = selectedCourse
    ? papers.filter((paper) => paper.course_id === selectedCourse.id)
    : [];
  const paperCount = (courseId: string) =>
    papers.filter((paper) => paper.course_id === courseId).length;

  let title = "Rimbly";
  let content: ReactNode = null;

  switch (route) {
    case "home":
      title = "Home";
      content = (
        <>
          <div className="dashboard-head">
            <div>
              <span className="eyebrow">Your study space</span>
              <h1>Welcome, {profile.full_name || "student"}.</h1>
              <p>
                {[profile.university, profile.department, profile.level]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button
              className="desktop-bell"
              onClick={() => navigate("notifications")}
              aria-label="Notifications"
            >
              ♧
            </button>
          </div>
          <section>
            <div className="section-title">
              <div>
                <span>From the study library</span>
                <h2>Courses for you</h2>
              </div>
              <button onClick={() => navigate("practice")}>Browse all ›</button>
            </div>
            {prioritizedCourses.length ? (
              <div className="course-list">
                {prioritizedCourses.slice(0, 4).map((course) => (
                  <CourseCard
                    key={course.id}
                    course={course}
                    paperCount={paperCount(course.id)}
                    onClick={() => {
                      setSelectedCourseId(course.id);
                      navigate("course");
                    }}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No courses yet"
                text="Courses will appear here as they are added to the study library."
                action="Open practice library"
                onAction={() => navigate("practice")}
              />
            )}
          </section>
          <section>
            <div className="section-title">
              <div>
                <span>Your account</span>
                <h2>Practice activity</h2>
              </div>
              <button onClick={() => navigate("quiz-history")}>Quiz history ›</button>
            </div>
            <div className="stats-grid">
              <Stat icon="✓" value={String(attempts.length)} label="Saved quizzes" />
              <Stat
                icon="◎"
                value={
                  attempts.length
                    ? `${Math.round(attempts.reduce((sum, item) => sum + item.score_percent, 0) / attempts.length)}%`
                    : "—"
                }
                label="Average score"
              />
              <Stat icon="▤" value={String(papers.length)} label="Published papers" />
            </div>
          </section>
          <section>
            <div className="section-title">
              <div>
                <span>Saved from the database</span>
                <h2>Recent quiz results</h2>
              </div>
            </div>
            {attempts.length ? (
              <div className="history-list">
                {attempts.slice(0, 3).map((attempt) => (
                  <AttemptRow
                    key={attempt.id}
                    attempt={attempt}
                    paper={papers.find((item) => item.id === attempt.paper_id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No quiz results yet"
                text="Complete a quiz from an approved paper to see your progress here."
                action="Find a paper"
                onAction={() => navigate("practice")}
              />
            )}
          </section>
        </>
      );
      break;
    case "practice":
      title = "Practice";
      content = (
        <PracticePage
          courses={prioritizedCourses}
          papers={papers}
          onQuiz={() => navigate("quiz-setup")}
          onSelect={(course) => {
            setSelectedCourseId(course.id);
            navigate("course");
          }}
          onNavigate={navigate}
        />
      );
      break;
    case "course":
      title = "Course";
      content = selectedCourse ? (
        <>
          <div className="page-head compact">
            <span className="eyebrow">{selectedCourse.university}</span>
            <h1>{selectedCourse.code}</h1>
            <p>
              {selectedCourse.title}
              {selectedCourse.department ? ` · ${selectedCourse.department}` : ""}
            </p>
          </div>
          <div className="course-actions">
            <Button onClick={() => navigate("quiz-setup")}>Choose a paper to practise</Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void handleToggleSaved(selectedCourse.id)}
            >
              {savedCourseIds.includes(selectedCourse.id) ? "Remove saved course" : "Save course"}
            </Button>
          </div>
          <section>
            <div className="section-title">
              <div>
                <span>Published in the library</span>
                <h2>Past papers</h2>
              </div>
            </div>
            {matchingPapers.length ? (
              <div className="course-list">
                {matchingPapers.map((paper) => (
                  <PaperRow
                    key={paper.id}
                    paper={paper}
                    onClick={() => {
                      setSelectedPaperId(paper.id);
                      navigate("paper");
                    }}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No papers for this course"
                text="Approved papers will appear here after they are added to the library."
                action="Contribute a paper"
                onAction={() => navigate("contribute")}
              />
            )}
          </section>
        </>
      ) : (
        <EmptyState
          title="Choose a course"
          text="Select a course in the practice library first."
          action="Browse courses"
          onAction={() => navigate("practice")}
        />
      );
      break;
    case "paper":
      title = "Past paper";
      content =
        selectedPaper && selectedCourse ? (
          <PaperPage
            paper={selectedPaper}
            course={selectedCourse}
            quizStatus={
              paperQuizAvailability?.paperId === selectedPaper.id
                ? paperQuizAvailability.status
                : "loading"
            }
            quizBusy={busy}
            watermark={user.email ?? profile?.full_name ?? "Rimbly user"}
            onQuiz={() =>
              void startQuiz(
                paperQuizAvailability?.paperId === selectedPaper.id
                  ? (paperQuizAvailability.quizId ?? undefined)
                  : undefined,
              )
            }
            onBattle={() => navigate("battle")}
          />
        ) : (
          <EmptyState
            title="Paper not found"
            text="Open a paper from a course to see its details."
            action="Browse courses"
            onAction={() => navigate("practice")}
          />
        );
      break;
    case "quiz-setup":
      title = "Take a quiz";
      content = (
        <>
          <div className="page-head compact">
            <span className="eyebrow">Published quizzes</span>
            <h1>Choose your challenge.</h1>
            <p>
              Your department and university matches appear first, but all published quizzes remain
              available. A moderator approves each question before it goes live.
            </p>
          </div>
          {publishedQuizSetsLoading ? (
            <p className="field-note" role="status">
              Loading published quizzes…
            </p>
          ) : prioritizedQuizSets.length ? (
            <div className="course-list">
              {prioritizedQuizSets.map((quiz) => (
                <QuizCatalogCard
                  key={quiz.id}
                  quiz={quiz}
                  busy={busy}
                  onTake={() => void startQuiz(quiz.id)}
                  onReadSource={() =>
                    setSourceToRead({
                      path: quiz.source_file_path!,
                      title: `Original source: ${quiz.title}`,
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <>
              <EmptyState
                title="No published quizzes found"
                text="A quiz appears after a reviewer approves at least one question with an answer key. Department labels affect priority, not visibility."
                action="Browse past questions"
                onAction={() => navigate("practice")}
              />
              <div className="admin-actions">
                <Button
                  variant="secondary"
                  disabled={publishedQuizSetsLoading}
                  onClick={() => void refreshPublishedQuizSets(true)}
                >
                  {publishedQuizSetsLoading ? "Refreshing…" : "Refresh quizzes"}
                </Button>
              </div>
            </>
          )}
        </>
      );
      break;
    case "quiz":
      title = "Quiz";
      content = questions.length ? (
        <QuizPage
          questions={questions}
          answers={answers}
          busy={busy}
          setAnswer={(id, choice) => setAnswers((current) => ({ ...current, [id]: choice }))}
          onSubmit={() => void handleSubmitQuiz()}
        />
      ) : (
        <EmptyState
          title="No quiz loaded"
          text="Start a quiz from one of the published papers."
          action="Go to practice"
          onAction={() => navigate("practice")}
        />
      );
      break;
    case "results":
      title = "Quiz results";
      content = lastAttempt ? (
        <ResultsPage
          attempt={lastAttempt}
          paper={papers.find((paper) => paper.id === lastAttempt.paper_id)}
          onRetry={() => navigate("quiz-setup")}
          onHistory={() => navigate("quiz-history")}
        />
      ) : (
        <EmptyState
          title="No saved result"
          text="Complete a quiz to see its score here."
          action="Browse papers"
          onAction={() => navigate("practice")}
        />
      );
      break;
    case "quiz-history":
      title = "Quiz history";
      content = (
        <>
          <div className="page-head compact">
            <span className="eyebrow">Your saved practice record</span>
            <h1>Quiz history.</h1>
            <p>Only your completed practice attempts are shown.</p>
          </div>
          {attempts.length ? (
            <div className="history-list">
              {attempts.map((attempt) => (
                <AttemptRow
                  key={attempt.id}
                  attempt={attempt}
                  paper={papers.find((paper) => paper.id === attempt.paper_id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No quiz attempts yet"
              text="Your saved attempts will show here after your first quiz."
              action="Find a paper"
              onAction={() => navigate("practice")}
            />
          )}
        </>
      );
      break;
    case "battle":
      title = "Battle";
      content = (
        <BattlePage
          userId={user.id}
          university={profile.university}
          onActivityRefresh={() => void refreshActivity()}
        />
      );
      break;
    case "leaderboard":
      title = "Leaderboard";
      content = (
        <>
          <div className="page-head">
            <span className="eyebrow">Community rankings</span>
            <h1>Climb the board.</h1>
            <p>
              Earn 10 points per correct answer and 4 for a battle win (1 for a draw or loss). Win
              streaks unlock status titles.
            </p>
          </div>
          <div className="segment" aria-label="Leaderboard scope">
            <button
              className={leaderboardScope === "university" ? "active" : ""}
              onClick={() => setLeaderboardScope("university")}
            >
              My university
            </button>
            <button
              className={leaderboardScope === "all" ? "active" : ""}
              onClick={() => setLeaderboardScope("all")}
            >
              All universities
            </button>
          </div>
          {leaders.length ? (
            <div className="ranking-list">
              {leaders.map((leader, index) => (
                <LeaderRow
                  key={leader.user_id}
                  leader={leader}
                  rank={index + 1}
                  isMe={leader.user_id === user.id}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No rankings yet"
              text="Take a reviewed quiz or win a battle to earn points and appear on the board."
              action="Find a quiz"
              onAction={() => navigate("quiz-setup")}
            />
          )}
        </>
      );
      break;
    case "profile":
      title = "Profile";
      content = (
        <>
          <div className="page-head compact">
            <span className="eyebrow">Your account</span>
            <h1>{profile.full_name}</h1>
            <p>{user.email}</p>
          </div>
          <form
            className="form-stack profile-edit"
            onSubmit={(event) => void handleSaveProfile(event)}
          >
            <label>
              <span>Full name</span>
              <input name="full_name" required defaultValue={profile.full_name} />
            </label>
            <label>
              <span>University</span>
              <select
                name="university"
                required
                defaultValue={profile.university ?? ""}
                disabled={!universities.length}
              >
                <option value="" disabled>
                  Select your university
                </option>
                {universities.map((university) => (
                  <option key={university.id} value={university.name}>
                    {university.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Faculty</span>
              <input name="faculty" defaultValue={profile.faculty ?? ""} />
            </label>
            <label>
              <span>Department</span>
              <input name="department" defaultValue={profile.department ?? ""} />
            </label>
            <label>
              <span>Level</span>
              <select name="level" required defaultValue={profile.level ?? ""}>
                <option value="" disabled>
                  Select your level
                </option>
                {[
                  "100 Level",
                  "200 Level",
                  "300 Level",
                  "400 Level",
                  "500 Level",
                  "Postgraduate",
                ].map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save profile"}
            </Button>
          </form>
          <section>
            <div className="section-title">
              <div>
                <span>Saved in your account</span>
                <h2>Saved courses</h2>
              </div>
            </div>
            {savedCourseIds.length ? (
              <div className="course-list">
                {courses
                  .filter((course) => savedCourseIds.includes(course.id))
                  .map((course) => (
                    <CourseCard
                      key={course.id}
                      course={course}
                      paperCount={paperCount(course.id)}
                      onClick={() => {
                        setSelectedCourseId(course.id);
                        navigate("course");
                      }}
                    />
                  ))}
              </div>
            ) : (
              <EmptyState
                title="No saved courses"
                text="Save a course from its page to keep it here."
                action="Browse courses"
                onAction={() => navigate("practice")}
              />
            )}
          </section>
          <section>
            <div className="section-title">
              <div>
                <span>Available across departments and universities</span>
                <h2>Published quizzes</h2>
              </div>
              <button onClick={() => navigate("quiz-setup")}>Browse all ›</button>
            </div>
            {publishedQuizSetsLoading ? (
              <p className="field-note" role="status">
                Loading published quizzes…
              </p>
            ) : prioritizedQuizSets.length ? (
              <div className="course-list">
                {prioritizedQuizSets.map((quiz) => (
                  <QuizCatalogCard
                    key={quiz.id}
                    quiz={quiz}
                    busy={busy}
                    onTake={() => void startQuiz(quiz.id)}
                    onReadSource={() =>
                      setSourceToRead({
                        path: quiz.source_file_path!,
                        title: `Original source: ${quiz.title}`,
                      })
                    }
                  />
                ))}
              </div>
            ) : (
              <>
                <EmptyState
                  title="No published quizzes found"
                  text="Published quizzes from every department appear here after review."
                  action="Browse quizzes"
                  onAction={() => navigate("quiz-setup")}
                />
                <div className="admin-actions">
                  <Button
                    variant="secondary"
                    disabled={publishedQuizSetsLoading}
                    onClick={() => void refreshPublishedQuizSets(true)}
                  >
                    {publishedQuizSetsLoading ? "Refreshing…" : "Refresh quizzes"}
                  </Button>
                </div>
              </>
            )}
          </section>
          <section>
            <div className="profile-menu-heading">
              <span className="eyebrow">Account & tools</span>
              <h2>Quick links</h2>
            </div>
            <div className="profile-menu">
              <button onClick={() => navigate("contribute")}>
                <span className="profile-menu-icon" aria-hidden="true">
                  ↑
                </span>
                <span className="profile-menu-copy">
                  <strong>My contributions</strong>
                  <small>
                    {contributions.length}{" "}
                    {contributions.length === 1 ? "submission" : "submissions"} · Track review
                    status
                  </small>
                </span>
                <span className="profile-menu-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
              {adminAccess?.permissions.includes("dashboard.access") && (
                <button className="profile-menu-admin" onClick={() => navigate("admin")}>
                  <span className="profile-menu-icon" aria-hidden="true">
                    ⚙
                  </span>
                  <span className="profile-menu-copy">
                    <strong>Admin workspace</strong>
                    <small>Manage content, accounts, and your team</small>
                  </span>
                  <span className="profile-menu-arrow" aria-hidden="true">
                    ›
                  </span>
                </button>
              )}
              <button onClick={() => navigate("suggest")}>
                <span className="profile-menu-icon" aria-hidden="true">
                  ✦
                </span>
                <span className="profile-menu-copy">
                  <strong>Send feedback</strong>
                  <small>Share an idea or report an issue</small>
                </span>
                <span className="profile-menu-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
              <button className="logout" disabled={busy} onClick={() => void handleSignOut()}>
                <span className="profile-menu-icon" aria-hidden="true">
                  ↗
                </span>
                <span className="profile-menu-copy">
                  <strong>Sign out</strong>
                  <small>End your current session</small>
                </span>
                <span className="profile-menu-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
            </div>
          </section>
        </>
      );
      break;
    case "contribute":
      title = "Contribute";
      content = (
        <ContributionPage
          profile={profile}
          universities={universities}
          busy={busy}
          contributions={contributions}
          error={pageError}
          onSubmit={(event) => void handleContribution(event)}
          onClearError={() => setError(null)}
        />
      );
      break;
    case "suggest":
      title = "Feedback";
      content = (
        <>
          <div className="page-head compact">
            <span className="eyebrow">Help improve Rimbly</span>
            <h1>Send feedback.</h1>
            <p>Your suggestion is saved for the Rimbly team to review.</p>
          </div>
          <form className="contribution-form" onSubmit={(event) => void handleSuggestion(event)}>
            <label>
              <span>Category</span>
              <select name="category" required>
                <option>Product suggestion</option>
                <option>Missing academic content</option>
                <option>Incorrect content</option>
                <option>Something else</option>
              </select>
            </label>
            <label>
              <span>University or course context</span>
              <input name="context" />
            </label>
            <label>
              <span>Your suggestion</span>
              <textarea name="suggestion" required minLength={5} />
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send feedback"}
            </Button>
          </form>
        </>
      );
      break;
    case "notifications":
      title = "Notifications";
      content = (
        <>
          <div className="page-head compact">
            <span className="eyebrow">Account updates</span>
            <h1>Notifications.</h1>
            {notifications.some((item) => !item.read_at) && (
              <Button variant="secondary" disabled={busy} onClick={() => void handleMarkRead()}>
                {busy ? "Saving…" : "Mark all as read"}
              </Button>
            )}
          </div>
          {notifications.length ? (
            <div className="activity-feed">
              {notifications.map((item) => (
                <article
                  key={item.id}
                  className={item.read_at ? "notification-read" : "notification-unread"}
                >
                  <b>{item.title}</b>
                  <p>{item.body}</p>
                  <small>{new Date(item.created_at).toLocaleString()}</small>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No notifications"
              text="Updates saved for your account will appear here."
            />
          )}
        </>
      );
      break;
    default:
      content = (
        <EmptyState
          title="Page not found"
          text="Choose a page from the navigation."
          action="Home"
          onAction={() => navigate("home")}
        />
      );
  }

  return (
    <>
      <Feedback error={pageError} clear={() => setError(null)} />
      {notice && (
        <div className="app-notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      <AppShell
        route={route}
        title={title}
        adminAvailable={Boolean(adminAccess?.permissions.includes("dashboard.access"))}
        onNavigate={navigate}
      >
        {content}
      </AppShell>
      {sourceToRead && (
        <SourceDocumentDialog
          path={sourceToRead.path}
          title={sourceToRead.title}
          watermark={user.email ?? profile?.full_name ?? "Rimbly user"}
          onClose={() => setSourceToRead(null)}
        />
      )}
    </>
  );
}

function AdminWorkspace({
  access,
  accessError,
  userId,
  profile,
  universities,
  maintenanceStatus,
  onMaintenanceChange,
  onNavigate,
}: {
  access: AdminAccess | null;
  accessError: string | null;
  userId: string;
  profile: Profile;
  universities: University[];
  maintenanceStatus: MaintenanceStatus | null;
  onMaintenanceChange: (status: MaintenanceStatus) => void;
  onNavigate: (route: Route) => void;
}) {
  const [section, setSection] = useState<
    | "overview"
    | "contributions"
    | "papers"
    | "quizzes"
    | "students"
    | "team"
    | "academics"
    | "maintenance"
    | "audit"
  >("overview");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [contributions, setContributions] = useState<AdminContribution[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [papers, setPapers] = useState<AdminPaper[]>([]);
  const [quizPapers, setQuizPapers] = useState<AdminQuizPaper[]>([]);
  const [adminQuizzes, setAdminQuizzes] = useState<AdminQuizSet[]>([]);
  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [team, setTeam] = useState<AdminTeamMember[]>([]);
  const [adminUniversities, setAdminUniversities] = useState<
    Array<{ id: string; name: string; is_active?: boolean }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [studentSearch, setStudentSearch] = useState("");
  const [maintenanceSaving, setMaintenanceSaving] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(maintenanceStatus?.active ?? false);
  const [maintenanceTitle, setMaintenanceTitle] = useState(
    maintenanceStatus?.title ?? "We’ll be back soon",
  );
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    maintenanceStatus?.message ?? "We’re making Rimbly better. Your account and progress are safe.",
  );
  const [maintenanceEndsAt, setMaintenanceEndsAt] = useState(() =>
    toLocalDateTimeInput(maintenanceStatus?.ends_at),
  );

  const canReview = Boolean(access?.permissions.includes("contributions.review"));
  const canViewAudit = Boolean(access?.permissions.includes("audit.view"));
  const canViewDashboard = Boolean(access?.permissions.includes("dashboard.access"));
  const canManagePapers = Boolean(access?.permissions.includes("papers.manage"));
  const canManageQuizzes = Boolean(
    access?.permissions.includes("quiz.manage") || access?.permissions.includes("quiz.review"),
  );
  const canCreateQuizzes = Boolean(access?.permissions.includes("quiz.manage"));
  const canReviewQuizzes = Boolean(access?.permissions.includes("quiz.review"));
  const canManageStudents = Boolean(access?.permissions.includes("students.manage"));
  const canManageTeam = Boolean(access?.permissions.includes("team.manage"));
  const canManageAcademics = Boolean(access?.permissions.includes("academics.manage"));
  const canManageMaintenance = access?.role === "super_admin";

  useEffect(() => {
    setMaintenanceEnabled(maintenanceStatus?.active ?? false);
    setMaintenanceTitle(maintenanceStatus?.title ?? "We’ll be back soon");
    setMaintenanceMessage(
      maintenanceStatus?.message ??
        "We’re making Rimbly better. Your account and progress are safe.",
    );
    setMaintenanceEndsAt(toLocalDateTimeInput(maintenanceStatus?.ends_at));
  }, [maintenanceStatus?.updated_at]);

  useEffect(() => {
    let active = true;
    if (!access) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    void Promise.all([
      canViewDashboard ? getAdminOverview() : Promise.resolve(null),
      canReview ? getAdminContributions() : Promise.resolve([]),
      canViewAudit ? getAdminAuditLogs() : Promise.resolve([]),
    ])
      .then(([nextOverview, nextContributions, nextAuditLogs]) => {
        if (!active) return;
        setOverview(nextOverview);
        setContributions(nextContributions);
        setAuditLogs(nextAuditLogs);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load admin workspace.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [access, canReview, canViewAudit, canViewDashboard]);

  useEffect(() => {
    if (!access || !canManageStudents || section !== "students") return;
    let active = true;
    setStudentsLoading(true);
    setStudentsError(null);
    const timer = window.setTimeout(() => {
      void getAdminStudents(studentSearch)
        .then((result) => {
          if (active) {
            setStudents(result);
            setStudentsLoading(false);
          }
        })
        .catch((searchError: unknown) => {
          if (active) {
            setStudentsError(getErrorMessage(searchError, "Could not search students."));
            setStudentsLoading(false);
          }
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [access, canManageStudents, section, studentSearch]);

  useEffect(() => {
    if (!access || section !== "papers" || !canManagePapers) return;
    let active = true;
    void getAdminPapers()
      .then((result) => {
        if (active) setPapers(result);
      })
      .catch((loadError: unknown) => {
        if (active)
          setError(loadError instanceof Error ? loadError.message : "Could not load past papers.");
      });
    return () => {
      active = false;
    };
  }, [access, canManagePapers, section]);

  useEffect(() => {
    if (!access || section !== "quizzes" || !canManageQuizzes) return;
    let active = true;
    void Promise.all([getAdminQuizSets(), getAdminQuizPapers()])
      .then(([nextQuizzes, nextPapers]) => {
        if (!active) return;
        setAdminQuizzes(nextQuizzes);
        setQuizPapers(nextPapers);
      })
      .catch((loadError: unknown) => {
        if (active)
          setError(loadError instanceof Error ? loadError.message : "Could not load quiz content.");
      });
    return () => {
      active = false;
    };
  }, [access, canManageQuizzes, section]);

  useEffect(() => {
    if (!access || section !== "team" || !canManageTeam) return;
    let active = true;
    void getAdminTeam()
      .then((result) => {
        if (active) setTeam(result);
      })
      .catch((loadError: unknown) => {
        if (active)
          setError(
            loadError instanceof Error ? loadError.message : "Could not load the admin team.",
          );
      });
    return () => {
      active = false;
    };
  }, [access, canManageTeam, section]);

  useEffect(() => {
    if (!access || section !== "academics" || !canManageAcademics) return;
    let active = true;
    void getAdminUniversities()
      .then((result) => {
        if (active) setAdminUniversities(result);
      })
      .catch((loadError: unknown) => {
        if (active)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load the academic directory.",
          );
      });
    return () => {
      active = false;
    };
  }, [access, canManageAcademics, section]);

  const openContribution = async (path: string | null) => {
    if (!path) {
      setError("This submission has no stored document path.");
      return;
    }
    setError(null);
    try {
      setPreviewUrl(await getAdminContributionUrl(path));
    } catch (previewError) {
      setError(
        previewError instanceof Error ? previewError.message : "Could not open the submission.",
      );
    }
  };

  const reviewContribution = async (item: AdminContribution, decision: "approved" | "rejected") => {
    const reason =
      decision === "rejected"
        ? window.prompt("Enter a reason for rejecting this contribution:")?.trim()
        : null;
    if (decision === "rejected" && !reason) {
      setError("A rejection reason is required.");
      return;
    }

    setBusyId(item.id);
    setError(null);
    try {
      await reviewAdminContribution(item.id, decision, reason ?? null);
      const [nextContributions, nextOverview, nextAuditLogs] = await Promise.all([
        canReview ? getAdminContributions() : Promise.resolve([]),
        canViewDashboard ? getAdminOverview() : Promise.resolve(null),
        canViewAudit ? getAdminAuditLogs() : Promise.resolve([]),
      ]);
      setContributions(nextContributions);
      setOverview(nextOverview);
      setAuditLogs(nextAuditLogs);
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : "Could not review this contribution.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const role = parseAdminRole(String(values.get("role") ?? ""));
    if (!role) {
      setError("Choose a valid team role.");
      return;
    }
    setBusyId("invite");
    setError(null);
    setNotice(null);
    try {
      await inviteAdmin(String(values.get("email") ?? ""), role);
      setTeam(await getAdminTeam());
      setNotice("Invitation email sent. Privileged access activates after the invite is accepted.");
      form.reset();
    } catch (inviteError) {
      setError(
        inviteError instanceof Error ? inviteError.message : "Could not invite this team member.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleTeamUpdate = async (
    member: AdminTeamMember,
    role: AdminAccess["role"],
    status: AdminTeamMember["status"],
  ) => {
    if (member.user_id === userId) {
      setError("You cannot change your own administrator access.");
      return;
    }
    setBusyId(member.user_id);
    setError(null);
    try {
      await updateAdminTeamMember(member.user_id, role, status);
      setTeam(await getAdminTeam());
      setNotice(`${member.email}'s access was updated.`);
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "Could not update this team member.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleStudentAccess = async (student: AdminStudent) => {
    const suspended = !student.suspended;
    const action = suspended ? "suspend" : "restore";
    if (
      !window.confirm(`Are you sure you want to ${action} ${student.full_name || student.email}?`)
    )
      return;
    setBusyId(student.user_id);
    setError(null);
    setNotice(null);
    try {
      await setAdminStudentSuspension(student.user_id, suspended);
      setStudents(await getAdminStudents(studentSearch));
      setNotice(`Student account ${suspended ? "suspended" : "restored"}.`);
    } catch (accessChangeError) {
      setError(
        accessChangeError instanceof Error
          ? accessChangeError.message
          : "Could not update student access.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleAdminPaperUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a paper document to upload.");
      return;
    }
    if (
      file.size > 20 * 1024 * 1024 ||
      !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
    ) {
      setError("Choose a PDF, JPG, or PNG file up to 20 MB.");
      return;
    }
    setBusyId("paper-upload");
    setError(null);
    setNotice(null);
    try {
      await publishAdminPaper(
        {
          university: String(values.get("university") ?? ""),
          courseCode: String(values.get("course_code") ?? ""),
          courseTitle: String(values.get("course_title") ?? ""),
          level: String(values.get("level") ?? ""),
          semester: String(values.get("semester") ?? ""),
          academicSession: String(values.get("academic_session") ?? ""),
          examYear: Number(values.get("exam_year")),
        },
        file,
      );
      setPapers(await getAdminPapers());
      setNotice("Paper uploaded and published to the student library.");
      form.reset();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Could not publish this paper.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const refreshAdminQuizzes = async () => {
    setAdminQuizzes(await getAdminQuizSets());
  };

  const handleCreateUniversity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusyId("university");
    setError(null);
    try {
      await saveAdminUniversity(null, String(values.get("name") ?? ""), true);
      setAdminUniversities(await getAdminUniversities());
      setNotice("University added to the academic directory.");
      form.reset();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not add this university.");
    } finally {
      setBusyId(null);
    }
  };

  const handleMaintenanceSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const active = values.get("maintenance_active") === "on";
    const localEndTime = String(values.get("ends_at") ?? "");
    if (active && !localEndTime) {
      setMaintenanceError("Choose when maintenance should end.");
      return;
    }

    setMaintenanceSaving(true);
    setMaintenanceError(null);
    setNotice(null);
    try {
      const nextStatus = await setMaintenanceStatus({
        active,
        endsAt: active ? new Date(localEndTime).toISOString() : null,
        title: String(values.get("title") ?? ""),
        message: String(values.get("message") ?? ""),
      });
      onMaintenanceChange(nextStatus);
      setNotice(
        nextStatus.active
          ? "Maintenance mode is on. Students will see the countdown page; Super Admins can keep using the full website."
          : "Maintenance mode is off. The website is open to everyone.",
      );
    } catch (saveError) {
      setMaintenanceError(
        saveError instanceof Error ? saveError.message : "Could not update maintenance settings.",
      );
    } finally {
      setMaintenanceSaving(false);
    }
  };

  const adminNav: { key: typeof section; label: string; visible: boolean }[] = [
    { key: "overview", label: "Overview", visible: canViewDashboard },
    { key: "contributions", label: "Review queue", visible: canReview },
    { key: "papers", label: "Past questions", visible: canManagePapers },
    { key: "quizzes", label: "Quiz authoring", visible: canManageQuizzes },
    { key: "students", label: "Students", visible: canManageStudents },
    { key: "team", label: "Team", visible: canManageTeam },
    { key: "academics", label: "Academics", visible: canManageAcademics },
    { key: "maintenance", label: "Maintenance", visible: canManageMaintenance },
    { key: "audit", label: "Audit logs", visible: canViewAudit },
  ];

  if (accessError) {
    return (
      <div className="admin-access-page">
        <h1>Admin setup required</h1>
        <p>
          Admin access could not be checked. Apply the admin foundation SQL migration, then reload.
        </p>
        <pre>{accessError}</pre>
        <p>
          Run <code>supabase/admin-foundation.sql</code> in the Supabase SQL Editor.
        </p>
        <button
          type="button"
          className="btn btn-secondary admin-return-link"
          onClick={() => onNavigate("home")}
        >
          Return to Rimbly
        </button>
      </div>
    );
  }

  if (!access || !canViewDashboard) {
    return (
      <div className="admin-access-page">
        <span className="eyebrow">Restricted workspace</span>
        <h1>Administrator access required.</h1>
        <p>
          Admin access is granted by a trusted project owner. Student accounts cannot enable
          administrator access themselves.
        </p>
        <button
          type="button"
          className="btn btn-secondary admin-return-link"
          onClick={() => onNavigate("home")}
        >
          Return to Rimbly
        </button>
      </div>
    );
  }

  const title = adminNav.find((item) => item.key === section)?.label ?? "Admin";

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Logo onClick={() => onNavigate("home")} />
        <span className="admin-sidebar-label">ADMINISTRATION</span>
        <nav aria-label="Admin navigation">
          {adminNav
            .filter((item) => item.visible)
            .map((item) => (
              <button
                key={item.key}
                type="button"
                className={section === item.key ? "active" : ""}
                aria-current={section === item.key ? "page" : undefined}
                onClick={() => setSection(item.key)}
              >
                {item.label}
              </button>
            ))}
        </nav>
        <button type="button" className="admin-back-link" onClick={() => onNavigate("home")}>
          <span aria-hidden="true">←</span>
          Student app
        </button>
      </aside>
      <main className="admin-content">
        <header className="admin-header">
          <div>
            <span className="eyebrow">{access.role.replace("_", " ")}</span>
            <h1>{title}</h1>
          </div>
          <span className="admin-secure-label">Server-verified access</span>
        </header>
        {error && <Feedback error={error} clear={() => setError(null)} />}
        {notice && (
          <p className="app-notice admin-notice" role="status">
            {notice}
          </p>
        )}
        {loading ? (
          <div className="admin-loading" role="status">
            <span className="loading-spinner" aria-hidden="true" />
            Loading admin workspace…
          </div>
        ) : (
          <>
            {section === "overview" && overview && (
              <section className="admin-metrics" aria-label="Platform metrics">
                {[
                  ["Students", overview.students],
                  ["Courses", overview.courses],
                  ["Published papers", overview.published_papers],
                  ["Pending reviews", overview.pending_contributions],
                  ["Quiz attempts", overview.quiz_attempts],
                  ["Active admins", overview.active_admins],
                ].map(([label, value]) => (
                  <article className="admin-metric" key={label}>
                    <small>{label}</small>
                    <strong>{Number(value).toLocaleString()}</strong>
                  </article>
                ))}
                {canReview && (
                  <button className="btn btn-primary" onClick={() => setSection("contributions")}>
                    Review pending contributions
                  </button>
                )}
                {canManagePapers && (
                  <button className="btn btn-secondary" onClick={() => setSection("papers")}>
                    Upload a past paper
                  </button>
                )}
              </section>
            )}
            {section === "contributions" && (
              <section className="admin-review-list">
                <div className="admin-section-heading">
                  <div>
                    <span className="eyebrow">Content moderation</span>
                    <h2>Contribution queue</h2>
                  </div>
                  <span>
                    {contributions.filter((item) => item.status === "pending").length} pending
                  </span>
                </div>
                {contributions.length ? (
                  contributions.map((item) => (
                    <article className="admin-contribution" key={item.id}>
                      <div className="admin-contribution-heading">
                        <div>
                          <strong>
                            {item.course_code} · {item.course_title}
                          </strong>
                          <small>
                            {item.university} · {item.level || "Level not provided"} ·{" "}
                            {item.semester || "Semester not provided"} ·{" "}
                            {item.academic_session || item.exam_year}
                          </small>
                        </div>
                        <span
                          className={`badge badge-${item.status === "approved" ? "green" : item.status === "rejected" ? "red" : "amber"}`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <p>
                        Submitted by {item.contributor_name} ({item.contributor_email}) on{" "}
                        {new Date(item.created_at).toLocaleString()}
                      </p>
                      {item.notes && <p>{item.notes}</p>}
                      {item.rejection_reason && <p>Reason: {item.rejection_reason}</p>}
                      <div className="admin-actions">
                        {item.storage_path && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => void openContribution(item.storage_path)}
                          >
                            Preview document
                          </button>
                        )}
                        {item.status === "pending" && (
                          <>
                            <button
                              className="btn btn-primary"
                              disabled={busyId === item.id}
                              onClick={() => void reviewContribution(item, "approved")}
                            >
                              {busyId === item.id ? "Saving…" : "Approve"}
                            </button>
                            <button
                              className="btn btn-secondary"
                              disabled={busyId === item.id}
                              onClick={() => void reviewContribution(item, "rejected")}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <EmptyState
                    title="No contributions yet"
                    text="Student submissions will appear here for review."
                  />
                )}
              </section>
            )}
            {section === "papers" && (
              <section className="admin-review-list">
                <div className="admin-section-heading">
                  <div>
                    <span className="eyebrow">Content library</span>
                    <h2>Upload and publish a past paper</h2>
                  </div>
                  <span>{papers.length} recent papers</span>
                </div>
                <form
                  className="admin-form"
                  onSubmit={(event) => void handleAdminPaperUpload(event)}
                >
                  <label>
                    <span>University</span>
                    <select name="university" required defaultValue={profile.university ?? ""}>
                      <option value="" disabled>
                        Select university
                      </option>
                      {universities.map((university) => (
                        <option key={university.id} value={university.name}>
                          {university.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-two">
                    <label>
                      <span>Course code</span>
                      <input name="course_code" required placeholder="CSC 101" />
                    </label>
                    <label>
                      <span>Course title</span>
                      <input name="course_title" required placeholder="Introduction to Computing" />
                    </label>
                  </div>
                  <div className="form-two">
                    <label>
                      <span>Academic session</span>
                      <input name="academic_session" required placeholder="2024/2025" />
                    </label>
                    <label>
                      <span>Exam year</span>
                      <input
                        name="exam_year"
                        type="number"
                        min="1990"
                        max={new Date().getFullYear() + 1}
                        required
                      />
                    </label>
                  </div>
                  <div className="form-two">
                    <label>
                      <span>Level</span>
                      <select name="level" defaultValue="">
                        <option value="">Not specified</option>
                        {[
                          "100 Level",
                          "200 Level",
                          "300 Level",
                          "400 Level",
                          "500 Level",
                          "Postgraduate",
                        ].map((level) => (
                          <option key={level}>{level}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Semester</span>
                      <select name="semester" defaultValue="">
                        <option value="">Not specified</option>
                        <option>First Semester</option>
                        <option>Second Semester</option>
                      </select>
                    </label>
                  </div>
                  <label className="upload-area">
                    <input
                      name="file"
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      required
                    />
                    <b>Choose a past paper</b>
                    <small>PDF, JPG, or PNG · Up to 20 MB</small>
                  </label>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={busyId === "paper-upload"}
                  >
                    {busyId === "paper-upload" ? "Uploading…" : "Upload and publish"}
                  </button>
                </form>
                <div className="admin-section-heading">
                  <div>
                    <span className="eyebrow">Latest content</span>
                    <h2>Recently added papers</h2>
                  </div>
                </div>
                {papers.length ? (
                  papers.slice(0, 30).map((paper) => (
                    <article className="admin-contribution" key={paper.id}>
                      <strong>
                        {paper.course_code} · {paper.course_title}
                      </strong>
                      <small>
                        {paper.university} · {paper.academic_session} · {paper.status}
                      </small>
                    </article>
                  ))
                ) : (
                  <EmptyState
                    title="No past papers yet"
                    text="Papers you publish will appear here and in the student library."
                  />
                )}
              </section>
            )}
            {section === "quizzes" && (
              <AdminQuizWorkspace
                quizzes={adminQuizzes}
                papers={quizPapers}
                universities={universities}
                userId={userId}
                canManage={canCreateQuizzes}
                canReview={canReviewQuizzes}
                onRefresh={refreshAdminQuizzes}
              />
            )}
            {section === "students" && (
              <section className="admin-review-list">
                <div className="admin-section-heading">
                  <div>
                    <span className="eyebrow">Account management</span>
                    <h2>Student accounts</h2>
                  </div>
                  <span>Showing up to 100 matches</span>
                </div>
                <label className="search-field admin-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={studentSearch}
                    onChange={(event) => setStudentSearch(event.target.value)}
                    placeholder="Search by name or email"
                  />
                </label>
                {studentsLoading ? (
                  <div className="admin-loading" role="status">
                    <span className="loading-spinner" aria-hidden="true" />
                    Searching student accounts…
                  </div>
                ) : studentsError ? (
                  <EmptyState title="Could not load student accounts" text={studentsError} />
                ) : students.length ? (
                  students.map((student) => (
                    <article className="admin-student-row" key={student.user_id}>
                      <div className="admin-student-avatar">
                        {(student.full_name || student.email || "S").slice(0, 1).toUpperCase()}
                      </div>
                      <div className="admin-student-info">
                        <strong>{student.full_name || "Student"}</strong>
                        <span>{student.email}</span>
                        <small>
                          {[student.university, student.department, student.level]
                            .filter(Boolean)
                            .join(" · ") || "Profile incomplete"}
                        </small>
                      </div>
                      <span className={`badge badge-${student.suspended ? "red" : "green"}`}>
                        {student.suspended ? "Suspended" : "Active"}
                      </span>
                      <button
                        className={`btn ${student.suspended ? "btn-secondary" : "btn-ghost"}`}
                        disabled={busyId === student.user_id}
                        onClick={() => void handleStudentAccess(student)}
                      >
                        {busyId === student.user_id
                          ? "Saving…"
                          : student.suspended
                            ? "Restore"
                            : "Suspend"}
                      </button>
                    </article>
                  ))
                ) : (
                  <EmptyState title="No matching students" text="Try another name or email." />
                )}
              </section>
            )}
            {section === "team" && (
              <section className="admin-review-list">
                <div className="admin-section-heading">
                  <div>
                    <span className="eyebrow">Privileged access</span>
                    <h2>Administrators & moderators</h2>
                  </div>
                  <span>{team.filter((member) => member.status === "active").length} active</span>
                </div>
                <form className="admin-invite-form" onSubmit={(event) => void handleInvite(event)}>
                  <div>
                    <h3>Invite a team member</h3>
                    <p>
                      They receive an email invitation. Admin access stays inactive until they
                      accept it.
                    </p>
                  </div>
                  <label>
                    <span>Email address</span>
                    <input name="email" type="email" required placeholder="name@example.com" />
                  </label>
                  <div className="admin-invite-actions">
                    <label>
                      <span>Role</span>
                      <select name="role" defaultValue="moderator">
                        <option value="moderator">Moderator</option>
                        <option value="admin">Admin</option>
                        {access.role === "super_admin" && (
                          <option value="super_admin">Super Admin</option>
                        )}
                      </select>
                    </label>
                    <button
                      className="btn btn-primary"
                      type="submit"
                      disabled={busyId === "invite"}
                    >
                      {busyId === "invite" ? "Sending…" : "Send invite"}
                    </button>
                  </div>
                </form>
                <div className="admin-team-list">
                  {team.map((member) => {
                    const isSelf = member.user_id === userId;
                    const actorCanManage =
                      !isSelf &&
                      (access.role === "super_admin" || member.role_id !== "super_admin");
                    return (
                      <article className="admin-team-row" key={member.user_id}>
                        <div className="admin-team-avatar">
                          {(member.full_name || member.email || "A").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="admin-team-member-info">
                          <strong>{member.full_name || member.email}</strong>
                          <span>
                            {member.email}
                            {isSelf ? " · You" : ""}
                          </span>
                          <small>
                            {member.accepted_at
                              ? `Joined ${new Date(member.accepted_at).toLocaleDateString()}`
                              : "Invitation not accepted yet"}
                          </small>
                        </div>
                        <span className="badge badge-purple">
                          {member.role_id.replace("_", " ")}
                        </span>
                        <span
                          className={`badge badge-${member.status === "active" ? "green" : member.status === "revoked" ? "red" : "amber"}`}
                        >
                          {member.status}
                        </span>
                        {actorCanManage && (
                          <div className="admin-team-actions">
                            <select
                              aria-label={`Role for ${member.email}`}
                              value={member.role_id}
                              disabled={busyId === member.user_id}
                              onChange={(event) => {
                                const nextRole = parseAdminRole(event.target.value);
                                if (nextRole)
                                  void handleTeamUpdate(member, nextRole, member.status);
                              }}
                            >
                              <option value="moderator">Moderator</option>
                              <option value="admin">Admin</option>
                              {access.role === "super_admin" && (
                                <option value="super_admin">Super Admin</option>
                              )}
                            </select>
                            {member.status === "active" || member.status === "suspended" ? (
                              <>
                                <button
                                  disabled={busyId === member.user_id}
                                  onClick={() =>
                                    void handleTeamUpdate(
                                      member,
                                      member.role_id,
                                      member.status === "suspended" ? "active" : "suspended",
                                    )
                                  }
                                >
                                  {member.status === "suspended" ? "Restore" : "Suspend"}
                                </button>
                                <button
                                  className="admin-revoke-action"
                                  disabled={busyId === member.user_id}
                                  onClick={() => {
                                    if (window.confirm(`Revoke admin access for ${member.email}?`))
                                      void handleTeamUpdate(member, member.role_id, "revoked");
                                  }}
                                >
                                  Revoke
                                </button>
                              </>
                            ) : member.status === "invited" ? (
                              <button
                                className="admin-revoke-action"
                                disabled={busyId === member.user_id}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Revoke the pending invitation for ${member.email}?`,
                                    )
                                  )
                                    void handleTeamUpdate(member, member.role_id, "revoked");
                                }}
                              >
                                Revoke invite
                              </button>
                            ) : (
                              <button
                                disabled={busyId === member.user_id}
                                onClick={() =>
                                  void handleTeamUpdate(
                                    member,
                                    member.role_id,
                                    member.accepted_at ? "active" : "invited",
                                  )
                                }
                              >
                                {member.accepted_at ? "Restore access" : "Restore invite"}
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            )}
            {section === "academics" && (
              <section className="admin-review-list">
                <div className="admin-section-heading">
                  <div>
                    <span className="eyebrow">Academic structure</span>
                    <h2>University directory</h2>
                  </div>
                  <span>{adminUniversities.length} universities</span>
                </div>
                <form
                  className="admin-inline-form"
                  onSubmit={(event) => void handleCreateUniversity(event)}
                >
                  <label>
                    <span>Add a university</span>
                    <input name="name" required placeholder="University name" />
                  </label>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={busyId === "university"}
                  >
                    {busyId === "university" ? "Saving…" : "Add university"}
                  </button>
                </form>
                <div className="admin-university-list">
                  {adminUniversities.map((university) => (
                    <article key={university.id}>
                      <span>{university.name}</span>
                      <small>Available in student profile and contribution forms</small>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {section === "maintenance" && canManageMaintenance && (
              <section className="admin-review-list">
                <div className="admin-section-heading">
                  <div>
                    <span className="eyebrow">Super Admin controls</span>
                    <h2>Website maintenance</h2>
                  </div>
                  <span className={`badge badge-${maintenanceStatus?.active ? "amber" : "green"}`}>
                    {maintenanceStatus?.active ? "Maintenance on" : "Website open"}
                  </span>
                </div>
                <div className="maintenance-admin-callout">
                  <span aria-hidden="true">✦</span>
                  <p>
                    Turning this on shows students a polished maintenance page with a live
                    countdown. <strong>Your Super Admin account keeps full access</strong> to the
                    whole website and these controls.
                  </p>
                </div>
                {maintenanceError && (
                  <Feedback error={maintenanceError} clear={() => setMaintenanceError(null)} />
                )}
                <form
                  className="admin-form maintenance-settings-form"
                  onSubmit={(event) => void handleMaintenanceSave(event)}
                >
                  <label className="maintenance-toggle">
                    <span className="maintenance-toggle-copy">
                      <strong>Put the website into maintenance</strong>
                      <small>
                        Only active Super Admin accounts can access the full website while this is
                        on.
                      </small>
                    </span>
                    <input
                      name="maintenance_active"
                      type="checkbox"
                      checked={maintenanceEnabled}
                      onChange={(event) => setMaintenanceEnabled(event.target.checked)}
                    />
                  </label>
                  <label>
                    <span>Maintenance page heading</span>
                    <input
                      name="title"
                      required
                      maxLength={100}
                      value={maintenanceTitle}
                      onChange={(event) => setMaintenanceTitle(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Message for students</span>
                    <textarea
                      name="message"
                      required
                      maxLength={500}
                      rows={3}
                      value={maintenanceMessage}
                      onChange={(event) => setMaintenanceMessage(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Expected maintenance end</span>
                    <input
                      name="ends_at"
                      type="datetime-local"
                      value={maintenanceEndsAt}
                      onChange={(event) => setMaintenanceEndsAt(event.target.value)}
                      required={maintenanceEnabled}
                      min={toLocalDateTimeInput(new Date().toISOString())}
                    />
                    <small className="field-note">
                      Uses your local timezone. The site automatically reopens at this time.
                    </small>
                  </label>
                  <button className="btn btn-primary" type="submit" disabled={maintenanceSaving}>
                    {maintenanceSaving
                      ? "Saving…"
                      : maintenanceStatus?.active
                        ? "Save maintenance settings"
                        : "Save website settings"}
                  </button>
                </form>
                {maintenanceStatus?.active && maintenanceStatus.ends_at && (
                  <p className="maintenance-current-state">
                    Currently scheduled to reopen{" "}
                    <strong>
                      {new Date(maintenanceStatus.ends_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </strong>
                    .
                  </p>
                )}
              </section>
            )}
            {section === "audit" && (
              <section className="admin-review-list">
                <div className="admin-section-heading">
                  <div>
                    <span className="eyebrow">Accountability</span>
                    <h2>Recent administrative actions</h2>
                  </div>
                </div>
                {auditLogs.length ? (
                  auditLogs.map((entry) => (
                    <article className="admin-audit-row" key={entry.id}>
                      <strong>{entry.action}</strong>
                      <span>
                        {entry.actor_name} · {entry.resource_type}
                        {entry.resource_id ? ` ${entry.resource_id}` : ""}
                      </span>
                      <small>{new Date(entry.created_at).toLocaleString()}</small>
                      <pre>{JSON.stringify(entry.details, null, 2)}</pre>
                    </article>
                  ))
                ) : (
                  <EmptyState
                    title="No audit events"
                    text="Sensitive admin actions are recorded here."
                  />
                )}
              </section>
            )}
          </>
        )}
        {previewUrl && (
          <div
            className="admin-preview-backdrop"
            role="presentation"
            onClick={() => setPreviewUrl(null)}
          >
            <section
              className="admin-document-preview"
              role="dialog"
              aria-modal="true"
              aria-label="Contribution document preview"
              onClick={(event) => event.stopPropagation()}
            >
              <header>
                <strong>Submission preview</strong>
                <div>
                  <a
                    className="btn btn-secondary"
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in new tab
                  </a>
                  <button onClick={() => setPreviewUrl(null)} aria-label="Close preview">
                    ×
                  </button>
                </div>
              </header>
              <iframe src={previewUrl} title="Uploaded contribution" />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="stat-card">
      <span>{icon}</span>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

function AdminQuizWorkspace({
  quizzes,
  papers,
  universities,
  userId,
  canManage,
  canReview,
  onRefresh,
}: {
  quizzes: AdminQuizSet[];
  papers: AdminQuizPaper[];
  universities: University[];
  userId: string;
  canManage: boolean;
  canReview: boolean;
  onRefresh: () => Promise<void>;
}) {
  type DraftQuestion = {
    prompt: string;
    options: string[];
    correct_index: number | null;
    explanation: string;
    review_status: QuizQuestionReviewStatus;
    source_page: string;
    source_note: string;
  };
  const emptyQuestion = (): DraftQuestion => ({
    prompt: "",
    options: ["", "", "", ""],
    correct_index: 0,
    explanation: "",
    review_status: "pending",
    source_page: "",
    source_note: "",
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [paperId, setPaperId] = useState("");
  const [audienceUniversity, setAudienceUniversity] = useState("");
  const [audienceDepartment, setAudienceDepartment] = useState("");
  const [audienceLevel, setAudienceLevel] = useState("");
  const studyLevels = ["100 Level", "200 Level", "300 Level", "400 Level", "500 Level"];
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);
  const [savedQuizId, setSavedQuizId] = useState<string | null>(null);
  const [revisionParentId, setRevisionParentId] = useState<string | null>(null);
  const [revisionSaved, setRevisionSaved] = useState(false);
  const [reviewingQuiz, setReviewingQuiz] = useState(false);
  const [reviewChangesSaved, setReviewChangesSaved] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<string | null>(null);
  const [aiQuestionJson, setAiQuestionJson] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceToView, setSourceToView] = useState<{ path: string; title: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const selectedPaper = papers.find((paper) => paper.id === paperId) ?? null;

  const saveDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const submitForReview =
      submitter instanceof HTMLButtonElement && submitter.value === "request_review";
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const savedId = await saveAdminQuizDraft({
        id: savedQuizId,
        title: String(values.get("title") ?? ""),
        description: String(values.get("description") ?? ""),
        paperId: paperId || null,
        audienceUniversity: String(values.get("audience_university") ?? ""),
        audienceDepartment: String(values.get("audience_department") ?? "").trim(),
        audienceLevel: String(values.get("audience_level") ?? ""),
        questions: questions.map((question) => ({
          prompt: question.prompt,
          options: question.options,
          correct_index: question.correct_index,
          explanation: question.explanation,
          review_status: question.review_status,
          source_page: question.source_page ? Number(question.source_page) : null,
          source_note: question.source_note,
        })),
      });
      setSavedQuizId(savedId);
      setRevisionSaved(true);
      if (reviewingQuiz) setReviewChangesSaved(true);

      if (submitForReview) {
        await requestAdminQuizReview(savedId);
        await onRefresh();
        const isRevision = Boolean(revisionParentId);
        setSavedQuizId(null);
        setTitle("");
        setDescription("");
        setPaperId("");
        setAudienceUniversity("");
        setAudienceDepartment("");
        setAudienceLevel("");
        setRevisionParentId(null);
        setRevisionSaved(false);
        setReviewingQuiz(false);
        setReviewChangesSaved(false);
        setQuestions([emptyQuestion()]);
        form.reset();
        setNotice(
          isRevision
            ? "Revision submitted for review. The current published quiz stays available until another reviewer approves it."
            : "Submitted for human review. A different reviewer must approve it before students can see it.",
        );
      } else {
        await onRefresh();
        setNotice(
          reviewingQuiz
            ? "Review edits saved. Only questions marked approved can be published."
            : revisionParentId
              ? "Revision draft saved. The current published quiz stays available until another reviewer approves this revision."
              : "Draft saved. It will not be visible to students until a different reviewer approves it.",
        );
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : submitForReview
            ? "Could not save and submit this quiz for review."
            : "Could not save this quiz draft.",
      );
    } finally {
      setSaving(false);
    }
  };

  const requestReview = async (quizId: string) => {
    if (quizId === savedQuizId && revisionParentId && !revisionSaved) {
      setError("Save the revision changes before requesting review.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await requestAdminQuizReview(quizId);
      await onRefresh();
      if (quizId === savedQuizId) {
        setSavedQuizId(null);
        setTitle("");
        setDescription("");
        setPaperId("");
        setAudienceUniversity("");
        setAudienceDepartment("");
        setAudienceLevel("");
        setRevisionParentId(null);
        setRevisionSaved(false);
        setReviewingQuiz(false);
        setReviewChangesSaved(false);
        setQuestions([emptyQuestion()]);
        formRef.current?.reset();
      }
      setNotice(
        revisionParentId
          ? "Revision submitted for human review. The current published quiz stays available until another reviewer approves this revision."
          : "Submitted for human review. The quiz remains unpublished until a different reviewer approves it.",
      );
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : "Could not request quiz review.",
      );
    } finally {
      setSaving(false);
    }
  };

  const review = async (quizId: string, decision: "publish" | "needs_revision") => {
    if (decision === "publish" && !reviewChangesSaved) {
      setError("Save your per-question review decisions before publishing.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await reviewAdminQuiz(quizId, decision);
      await onRefresh();
      if (quizId === savedQuizId) {
        setSavedQuizId(null);
        setReviewingQuiz(false);
        setReviewChangesSaved(false);
        setAudienceUniversity("");
        setAudienceDepartment("");
        setAudienceLevel("");
        setQuestions([emptyQuestion()]);
        formRef.current?.reset();
      }
      setNotice(
        decision === "publish"
          ? revisionParentId
            ? "Revision published. The previous quiz version is archived, and its attempt history is preserved."
            : "Approved questions are now available for practice and battles."
          : "Returned to the quiz creator for revision.",
      );
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not review this quiz.");
    } finally {
      setSaving(false);
    }
  };

  const editDraft = async (quizId: string, forReview = false, createRevision = false) => {
    setSaving(true);
    setError(null);
    try {
      const draftId = createRevision ? await createAdminQuizRevision(quizId) : quizId;
      if (createRevision) await onRefresh();
      const draft = await getAdminQuizDraft(draftId);
      setSavedQuizId(draft.id);
      setRevisionParentId(draft.replaces_quiz_id ?? null);
      setRevisionSaved(true);
      setReviewingQuiz(forReview);
      setReviewChangesSaved(!forReview);
      setTitle(draft.title);
      setDescription(draft.description);
      setPaperId(draft.paper_id ?? "");
      setAudienceUniversity(draft.audience_university ?? "");
      setAudienceDepartment(draft.audience_department ?? "");
      setAudienceLevel(draft.audience_level ?? "");
      setQuestions(
        draft.questions.map((question) => ({
          ...question,
          correct_index: question.correct_index,
          explanation: question.explanation,
          review_status: question.review_status,
          source_page: question.source_page ? String(question.source_page) : "",
        })),
      );
      setNotice(
        forReview
          ? "Review each question and answer key, and check any attached source. Save your decisions before publishing."
          : draft.replaces_quiz_id
            ? "Edit this revision and request a separate review. The current published quiz stays available until the revision is approved."
            : "Draft loaded for editing.",
      );
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load this quiz draft.");
    } finally {
      setSaving(false);
    }
  };

  const archiveQuiz = async (quizId: string, quizTitle: string) => {
    const confirmed = window.confirm(
      `Delete “${quizTitle}” and its revisions from the quiz catalog? Attempts and battle history will be preserved.`,
    );
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await archiveAdminQuizSet(quizId);
      await onRefresh();
      if (savedQuizId === quizId || revisionParentId === quizId) {
        setSavedQuizId(null);
        setTitle("");
        setDescription("");
        setPaperId("");
        setAudienceUniversity("");
        setAudienceDepartment("");
        setAudienceLevel("");
        setRevisionParentId(null);
        setRevisionSaved(false);
        setReviewingQuiz(false);
        setReviewChangesSaved(false);
        setQuestions([emptyQuestion()]);
        formRef.current?.reset();
      }
      setNotice("Quiz deleted from the catalog. Its attempts and battle history are preserved.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete this quiz.");
    } finally {
      setSaving(false);
    }
  };

  const updateQuestion = (index: number, patch: Partial<DraftQuestion>) => {
    if (reviewingQuiz) setReviewChangesSaved(false);
    if (revisionParentId) setRevisionSaved(false);
    setQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index ? { ...question, ...patch } : question,
      ),
    );
  };

  const copyQuestionPrompt = async () => {
    try {
      await navigator.clipboard.writeText(adminQuestionPrompt);
      setPromptCopied(true);
      setNotice(
        "AI prompt copied. Attach the source PDF in your AI tool, then paste its JSON result below.",
      );
    } catch {
      setError("Could not access the clipboard. Open “View AI prompt” and copy the text manually.");
    }
  };

  const importAiQuestions = () => {
    setError(null);
    setNotice(null);
    try {
      const source = aiQuestionJson
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed: unknown = JSON.parse(source);
      const candidates = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null && "questions" in parsed
          ? (parsed as { questions?: unknown }).questions
          : null;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error("Paste a JSON array of questions or an object with a questions array.");
      }

      const imported = candidates.map((candidate, index): DraftQuestion => {
        if (typeof candidate !== "object" || candidate === null) {
          throw new Error(`Question ${index + 1} is not a valid object.`);
        }
        const item = candidate as Record<string, unknown>;
        const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
        const options = Array.isArray(item.options)
          ? item.options.map((option) => (typeof option === "string" ? option.trim() : ""))
          : [];
        const answer = item.correct_index ?? null;
        const page =
          item.source_page == null || item.source_page === "" ? null : Number(item.source_page);
        const explanation = typeof item.explanation === "string" ? item.explanation.trim() : "";
        const sourceNote = typeof item.source_note === "string" ? item.source_note.trim() : "";
        if (!prompt || prompt.length > 2000 || options.length < 2 || options.length > 6) {
          throw new Error(`Question ${index + 1} needs text and 2–6 answer options.`);
        }
        if (options.some((option) => !option || option.length > 500)) {
          throw new Error(`Question ${index + 1} has an empty or overlong answer option.`);
        }
        if (explanation.length > 2000 || sourceNote.length > 500) {
          throw new Error(`Question ${index + 1} has an overlong explanation or source note.`);
        }
        if (
          answer !== null &&
          (!Number.isInteger(answer) || Number(answer) < 0 || Number(answer) >= options.length)
        ) {
          throw new Error(`Question ${index + 1} has an invalid zero-based correct_index.`);
        }
        if (page !== null && (!Number.isInteger(page) || page < 1)) {
          throw new Error(`Question ${index + 1} has an invalid source_page.`);
        }

        return {
          prompt,
          options,
          correct_index: answer === null ? null : Number(answer),
          explanation,
          review_status: "pending",
          source_page: page === null ? "" : String(page),
          source_note: sourceNote,
        };
      });

      const hasBlankStarter =
        questions.length === 1 &&
        !questions[0].prompt.trim() &&
        questions[0].options.every((option) => !option.trim());
      const currentQuestionCount = hasBlankStarter ? 0 : questions.length;
      if (currentQuestionCount + imported.length > 100) {
        throw new Error("A quiz can contain at most 100 questions.");
      }
      setQuestions((current) => {
        const replaceBlankStarter =
          current.length === 1 &&
          !current[0].prompt.trim() &&
          current[0].options.every((option) => !option.trim());
        return replaceBlankStarter ? imported : [...current, ...imported];
      });
      if (revisionParentId) setRevisionSaved(false);
      setAiQuestionJson("");
      setNotice(
        `${imported.length} AI suggestions added as pending questions. Check each against the original before saving.`,
      );
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (importError) {
      setError(getErrorMessage(importError, "Could not import the AI question output."));
    }
  };

  const extractQuestions = async () => {
    if (!paperId || !selectedPaper) return;
    setExtracting(true);
    setExtractionProgress("Preparing the source paper…");
    setError(null);
    setNotice(null);
    try {
      const { questions: extracted, warning } = await extractAdminQuizQuestions(
        paperId,
        selectedPaper.file_path,
        setExtractionProgress,
      );
      if (!extracted.length) {
        if (warning) setError(warning);
        else
          setNotice("No clear questions were found. Add questions manually or try another source.");
        return;
      }
      if (questions.length + extracted.length > 100) {
        throw new Error(
          "Extraction would exceed the 100-question limit. Remove questions and retry.",
        );
      }
      if (revisionParentId) setRevisionSaved(false);
      setQuestions((current) => [
        ...current,
        ...extracted.map((question) => ({
          ...question,
          review_status: "pending" as const,
          source_page: question.source_page ? String(question.source_page) : "",
        })),
      ]);
      if (warning) {
        setError(warning);
        setNotice(`${extracted.length} suggestions added as pending questions.`);
      } else {
        setNotice(
          `${extracted.length} suggestions added as pending questions. Verify every prompt, option, answer, and explanation against the original paper.`,
        );
      }
    } catch (extractError) {
      setError(
        extractError instanceof Error ? extractError.message : "Could not extract questions.",
      );
    } finally {
      setExtracting(false);
      setExtractionProgress(null);
    }
  };

  return (
    <>
      <section className="admin-review-list">
        <div className="admin-section-heading">
          <div>
            <span className="eyebrow">
              {reviewingQuiz
                ? "Human question review"
                : revisionParentId
                  ? "Published quiz revision"
                  : canManage
                    ? "Quiz authoring"
                    : "Review queue"}
            </span>
            <h2>
              {reviewingQuiz
                ? "Review questions and attached sources"
                : revisionParentId
                  ? "Edit published quiz"
                  : canManage
                    ? "Create a question set"
                    : "Pending question sets"}
            </h2>
          </div>
          <span>{quizzes.length} quizzes</span>
        </div>
        {(canManage || (canReview && reviewingQuiz)) && (
          <p className="admin-quiz-guidance">
            A source paper is optional. Link one to review against an original PDF or use
            Groq&apos;s page extraction; otherwise create questions manually or paste AI-generated
            JSON. Saving alone leaves a draft. Use “Save and request review” to send it to a
            different reviewer before students can see it.
            {revisionParentId &&
              " The currently published version remains available until another reviewer approves this revision."}
          </p>
        )}
        {canManage && !reviewingQuiz && (
          <section className="admin-ai-toolkit" aria-labelledby="admin-ai-toolkit-title">
            <div className="admin-ai-toolkit-header">
              <div>
                <span className="eyebrow">AI-assisted authoring</span>
                <h3 id="admin-ai-toolkit-title">Create questions from a PDF</h3>
              </div>
              <Button type="button" variant="secondary" onClick={() => void copyQuestionPrompt()}>
                {promptCopied ? "Prompt copied" : "Copy AI prompt"}
              </Button>
            </div>
            <p>
              For Groq page extraction, upload a PDF under <strong>Past questions</strong> and
              select it below. Source papers are optional for manual quizzes and pasted AI JSON.
            </p>
            <details>
              <summary>View the reusable AI prompt</summary>
              <pre>{adminQuestionPrompt}</pre>
            </details>
            <details className="admin-ai-import">
              <summary>Paste AI JSON to fill the question fields</summary>
              <label htmlFor="admin-ai-question-json">AI-generated JSON</label>
              <textarea
                id="admin-ai-question-json"
                rows={6}
                value={aiQuestionJson}
                onChange={(event) => setAiQuestionJson(event.target.value)}
                placeholder='Paste a JSON object with a "questions" array.'
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!aiQuestionJson.trim()}
                onClick={importAiQuestions}
              >
                Import as pending questions
              </Button>
            </details>
            {promptCopied && (
              <span className="sr-only" role="status">
                AI prompt copied to clipboard.
              </span>
            )}
          </section>
        )}
        {error && (
          <p className="app-feedback" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="app-notice" role="status">
            {notice}
          </p>
        )}
        {(canManage || (canReview && reviewingQuiz)) && (
          <form
            ref={formRef}
            className="admin-form"
            onChange={() => {
              if (revisionParentId) setRevisionSaved(false);
            }}
            onSubmit={(event) => void saveDraft(event)}
          >
            <label>
              <span>Quiz title</span>
              <input
                name="title"
                required
                maxLength={160}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. CSC 101 · 2024/25 revision"
              />
            </label>
            <label>
              <span>Description (optional)</span>
              <textarea
                name="description"
                maxLength={2000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
              />
            </label>
            <fieldset className="quiz-audience-targeting">
              <legend>Audience labels</legend>
              <p className="field-note">
                These labels are informational only and never restrict who can view or take a quiz.
              </p>
              <div className="quiz-audience-fields">
                <label>
                  <span>University label</span>
                  <select
                    name="audience_university"
                    value={audienceUniversity}
                    onChange={(event) => setAudienceUniversity(event.target.value)}
                  >
                    <option value="">No university label</option>
                    {universities.map((university) => (
                      <option key={university.id} value={university.name}>
                        {university.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Department label (optional)</span>
                  <input
                    name="audience_department"
                    maxLength={120}
                    value={audienceDepartment}
                    onChange={(event) => setAudienceDepartment(event.target.value)}
                    placeholder="Department name"
                  />
                </label>
                <label>
                  <span>Year / level label (optional)</span>
                  <select
                    name="audience_level"
                    value={audienceLevel}
                    onChange={(event) => setAudienceLevel(event.target.value)}
                  >
                    <option value="">No year label</option>
                    {studyLevels.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>
            <label>
              <span>Reference paper (optional)</span>
              <select
                value={paperId}
                disabled={Boolean(savedQuizId && paperId)}
                onChange={(event) => setPaperId(event.target.value)}
              >
                <option value="">No source paper</option>
                {papers.map((paper) => (
                  <option key={paper.id} value={paper.id}>
                    {paper.university} · {paper.course_code} · {paper.academic_session}
                  </option>
                ))}
              </select>
              <small className="field-note">
                Optional. You can add a paper later, but once linked it cannot be changed. A source
                enables the original viewer and Groq page extraction.
              </small>
            </label>
            {selectedPaper && (
              <div className="admin-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setSourceToView({
                      path: selectedPaper.file_path,
                      title: `${selectedPaper.university} · ${selectedPaper.course_code} · ${selectedPaper.academic_session}`,
                    })
                  }
                >
                  View original paper
                </Button>
                {canManage && !reviewingQuiz && (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={extracting}
                      onClick={() => void extractQuestions()}
                    >
                      {extracting
                        ? (extractionProgress ?? "Extracting suggestions…")
                        : "Extract questions (AI assist)"}
                    </Button>
                    <small className="field-note">
                      This sends rendered pages of the selected paper to Groq for extraction.
                      Suggestions remain pending until reviewed.
                    </small>
                  </>
                )}
              </div>
            )}
            {questions.map((question, questionIndex) => (
              <fieldset className="quiz-question-editor" key={questionIndex}>
                <legend>
                  Question {questionIndex + 1}
                  {reviewingQuiz ? ` · ${question.review_status}` : ""}
                </legend>
                {questions.length > 1 && (
                  <button
                    type="button"
                    className="quiz-remove-question"
                    onClick={() => {
                      if (reviewingQuiz) setReviewChangesSaved(false);
                      if (revisionParentId) setRevisionSaved(false);
                      setQuestions((current) =>
                        current.filter((_, index) => index !== questionIndex),
                      );
                    }}
                  >
                    Remove question
                  </button>
                )}
                <label>
                  <span>Question text</span>
                  <textarea
                    required
                    maxLength={2000}
                    value={question.prompt}
                    onChange={(event) =>
                      updateQuestion(questionIndex, { prompt: event.target.value })
                    }
                    rows={3}
                  />
                </label>
                <div className="quiz-answer-options">
                  {question.options.map((option, optionIndex) => (
                    <label key={optionIndex}>
                      <span>Option {String.fromCharCode(65 + optionIndex)}</span>
                      <span className="quiz-option-input">
                        <input
                          required
                          maxLength={500}
                          value={option}
                          onChange={(event) =>
                            updateQuestion(questionIndex, {
                              options: question.options.map((value, index) =>
                                index === optionIndex ? event.target.value : value,
                              ),
                            })
                          }
                        />
                        {question.options.length > 2 && (
                          <button
                            type="button"
                            aria-label={`Remove option ${String.fromCharCode(65 + optionIndex)}`}
                            onClick={() =>
                              updateQuestion(questionIndex, {
                                options: question.options.filter(
                                  (_, index) => index !== optionIndex,
                                ),
                                correct_index:
                                  question.correct_index === null
                                    ? null
                                    : question.correct_index === optionIndex
                                      ? 0
                                      : question.correct_index > optionIndex
                                        ? question.correct_index - 1
                                        : question.correct_index,
                              })
                            }
                          >
                            ×
                          </button>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {question.options.length < 6 && (
                  <button
                    type="button"
                    className="quiz-add-option"
                    onClick={() =>
                      updateQuestion(questionIndex, { options: [...question.options, ""] })
                    }
                  >
                    Add answer option
                  </button>
                )}
                <div className="form-two">
                  <label>
                    <span>Correct answer</span>
                    <select
                      required={reviewingQuiz && question.review_status === "approved"}
                      value={question.correct_index ?? ""}
                      onChange={(event) =>
                        updateQuestion(questionIndex, {
                          correct_index: event.target.value ? Number(event.target.value) : null,
                        })
                      }
                    >
                      <option value="">Select correct answer</option>
                      {question.options.map((_, optionIndex) => (
                        <option key={optionIndex} value={optionIndex}>
                          Option {String.fromCharCode(65 + optionIndex)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Source page (optional)</span>
                    <input
                      type="number"
                      min="1"
                      value={question.source_page}
                      onChange={(event) =>
                        updateQuestion(questionIndex, { source_page: event.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  <span>Explanation (optional)</span>
                  <textarea
                    maxLength={2000}
                    value={question.explanation}
                    onChange={(event) =>
                      updateQuestion(questionIndex, { explanation: event.target.value })
                    }
                    rows={2}
                  />
                </label>
                <label>
                  <span>Source note (optional)</span>
                  <input
                    value={question.source_note}
                    maxLength={500}
                    onChange={(event) =>
                      updateQuestion(questionIndex, { source_note: event.target.value })
                    }
                    placeholder="Reference to the original paper or marking guide"
                  />
                </label>
                {reviewingQuiz && (
                  <label>
                    <span>Question review decision</span>
                    <select
                      value={question.review_status}
                      onChange={(event) =>
                        updateQuestion(questionIndex, {
                          review_status: event.target.value as QuizQuestionReviewStatus,
                        })
                      }
                    >
                      <option value="pending">Pending review</option>
                      <option value="approved">Approve question</option>
                      <option value="rejected">Reject question</option>
                    </select>
                  </label>
                )}
              </fieldset>
            ))}
            <div className="admin-actions">
              <Button
                variant="secondary"
                disabled={saving || questions.length >= 100}
                onClick={() => {
                  if (reviewingQuiz) setReviewChangesSaved(false);
                  if (revisionParentId) setRevisionSaved(false);
                  setQuestions((current) => [...current, emptyQuestion()]);
                }}
              >
                Add question
              </Button>
              <Button type="submit" disabled={saving}>
                {saving
                  ? "Saving…"
                  : reviewingQuiz
                    ? "Save review decisions"
                    : revisionParentId
                      ? "Save revision draft"
                      : savedQuizId
                        ? "Save draft changes"
                        : "Save quiz draft"}
              </Button>
              {canManage && !reviewingQuiz && (
                <Button
                  type="submit"
                  variant="secondary"
                  name="submit_action"
                  value="request_review"
                  disabled={saving}
                >
                  {saving ? "Submitting…" : "Save and request review"}
                </Button>
              )}
              {reviewingQuiz && savedQuizId && (
                <>
                  <Button
                    type="button"
                    disabled={saving || !reviewChangesSaved}
                    onClick={() => void review(savedQuizId, "publish")}
                  >
                    Publish quiz
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => void review(savedQuizId, "needs_revision")}
                  >
                    Return set for edits
                  </Button>
                </>
              )}
            </div>
          </form>
        )}

        <div className="admin-section-heading">
          <div>
            <span className="eyebrow">Review workflow</span>
            <h2>Quiz question sets</h2>
          </div>
        </div>
        {quizzes.length ? (
          quizzes.map((quiz) => (
            <article className="admin-contribution admin-quiz-row" key={quiz.id}>
              <div>
                <strong>{quiz.title}</strong>
                <small>
                  {quiz.paper_id
                    ? (papers.find((paper) => paper.id === quiz.paper_id)?.course_code ??
                      "Linked past paper")
                    : "No source paper"}{" "}
                  · {quiz.question_count} questions · Labels:{" "}
                  {[quiz.audience_university, quiz.audience_department, quiz.audience_level]
                    .filter(Boolean)
                    .join(" · ") || "No audience labels"}{" "}
                  · Created by {quiz.creator_name}
                </small>
                {quiz.replaces_quiz_id && (
                  <small className="field-note">
                    Revision draft. The current published version remains available until approval.
                  </small>
                )}
              </div>
              {quiz.paper_id && papers.some((paper) => paper.id === quiz.paper_id) && (
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    const sourcePaper = papers.find((paper) => paper.id === quiz.paper_id);
                    if (sourcePaper) {
                      setSourceToView({
                        path: sourcePaper.file_path,
                        title: `${sourcePaper.university} · ${sourcePaper.course_code} · ${sourcePaper.academic_session}`,
                      });
                    }
                  }}
                >
                  View original
                </Button>
              )}
              <span
                className={`badge ${quiz.status === "published" ? "badge-green" : "badge-amber"}`}
              >
                {quiz.status.replace("_", " ")}
              </span>
              {canManage &&
                quiz.created_by === userId &&
                ["draft", "needs_revision"].includes(quiz.status) && (
                  <>
                    <Button
                      variant="secondary"
                      disabled={saving || quiz.id === savedQuizId}
                      onClick={() => void editDraft(quiz.id)}
                    >
                      {quiz.replaces_quiz_id ? "Edit revision" : "Edit draft"}
                    </Button>
                    <Button
                      disabled={
                        saving ||
                        (quiz.id === savedQuizId &&
                          Boolean(quiz.replaces_quiz_id) &&
                          !revisionSaved)
                      }
                      onClick={() => void requestReview(quiz.id)}
                    >
                      {quiz.replaces_quiz_id ? "Request revision review" : "Request review"}
                    </Button>
                  </>
                )}
              {canManage &&
                quiz.created_by === userId &&
                quiz.status === "published" &&
                !quizzes.some(
                  (revision) =>
                    revision.replaces_quiz_id === quiz.id &&
                    ["draft", "needs_revision", "pending_review"].includes(revision.status),
                ) && (
                  <Button
                    variant="secondary"
                    disabled={saving}
                    onClick={() => void editDraft(quiz.id, false, true)}
                  >
                    Edit quiz
                  </Button>
                )}
              {canManage && quiz.created_by === userId && (
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => void archiveQuiz(quiz.id, quiz.title)}
                >
                  Delete quiz
                </Button>
              )}
              {canReview && quiz.created_by !== userId && quiz.status === "pending_review" && (
                <Button disabled={saving} onClick={() => void editDraft(quiz.id, true)}>
                  Review questions
                </Button>
              )}
            </article>
          ))
        ) : (
          <EmptyState
            title="No quiz sets yet"
            text="Create a question set with or without a source paper. It stays unpublished until another reviewer approves its questions."
          />
        )}
      </section>
      {sourceToView && (
        <SourceDocumentDialog
          path={sourceToView.path}
          title={sourceToView.title}
          watermark="Rimbly moderator"
          onClose={() => setSourceToView(null)}
        />
      )}
    </>
  );
}

function PracticePage({
  courses,
  papers,
  onQuiz,
  onSelect,
  onNavigate,
}: {
  courses: Course[];
  papers: Paper[];
  onQuiz: () => void;
  onSelect: (course: Course) => void;
  onNavigate: (route: Route) => void;
}) {
  const [search, setSearch] = useState("");
  const displayed = courses.filter((course) =>
    `${course.code} ${course.title} ${course.department ?? ""} ${course.university}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Past questions library</span>
        <h1>Practice with the whole library.</h1>
        <p>
          Courses from every department and university are included, with your study profile matches
          first.
        </p>
        <Button onClick={onQuiz}>Take a published quiz</Button>
      </div>
      <label className="search-field">
        <span aria-hidden="true">⌕</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search course code, title, department, or university"
        />
      </label>
      <section>
        <div className="section-title">
          <div>
            <span>
              {displayed.length} {displayed.length === 1 ? "course" : "courses"}
            </span>
            <h2>All departments and universities</h2>
          </div>
        </div>
        {displayed.length ? (
          <div className="course-list">
            {displayed.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                paperCount={papers.filter((paper) => paper.course_id === course.id).length}
                onClick={() => onSelect(course)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title={courses.length ? "No matching courses" : "The library is empty"}
            text={
              courses.length
                ? "Try a different search term."
                : "Ask an administrator to add courses to the study library."
            }
            action={courses.length ? "Clear search" : "Contribute a paper"}
            onAction={() => (courses.length ? setSearch("") : onNavigate("contribute"))}
          />
        )}
      </section>
    </>
  );
}

function BattlePage({
  userId,
  university,
  onActivityRefresh,
}: {
  userId: string;
  university: string | null;
  onActivityRefresh: () => void;
}) {
  const [quizzes, setQuizzes] = useState<QuizSet[]>([]);
  const [opponents, setOpponents] = useState<Awaited<ReturnType<typeof getBattleOpponents>>>([]);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [search, setSearch] = useState("");
  const [quizId, setQuizId] = useState("");
  const [activeBattleId, setActiveBattleId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshBattles = async () => {
    setBattles(await getBattles());
  };

  useEffect(() => {
    let active = true;
    void Promise.all([getPublishedQuizSets(), getBattles()])
      .then(([nextQuizzes, nextBattles]) => {
        if (!active) return;
        setQuizzes(nextQuizzes);
        setBattles(nextBattles);
      })
      .catch((loadError: unknown) => {
        if (active)
          setError(
            loadError instanceof Error ? loadError.message : "Could not load the battle arena.",
          );
      });
    const interval = window.setInterval(() => {
      void getBattles()
        .then((result) => {
          if (active) setBattles(result);
        })
        .catch((refreshError: unknown) => {
          if (active)
            setError(
              refreshError instanceof Error ? refreshError.message : "Could not refresh battles.",
            );
        });
    }, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void getBattleOpponents(search)
        .then((result) => {
          if (active) setOpponents(result);
        })
        .catch((searchError: unknown) => {
          if (active)
            setError(
              searchError instanceof Error ? searchError.message : "Could not find players.",
            );
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [search]);

  const respond = async (battleId: string, accept: boolean) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await respondToBattle(battleId, accept);
      await refreshBattles();
      setNotice(
        accept ? "Challenge accepted. You can start the shared quiz now." : "Challenge declined.",
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Could not respond to challenge.",
      );
    } finally {
      setBusy(false);
    }
  };

  const challenge = async (opponentId: string) => {
    if (!quizId) {
      setError("Choose a published quiz for your challenge.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createBattle(quizId, opponentId);
      await refreshBattles();
      setNotice("Challenge sent. Your opponent will get the same questions when they accept.");
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Could not send this challenge.",
      );
    } finally {
      setBusy(false);
    }
  };

  const startBattle = async (battleId: string) => {
    setBusy(true);
    setError(null);
    try {
      const nextQuestions = await getBattleQuestions(battleId);
      setQuestions(nextQuestions);
      setAnswers({});
      setActiveBattleId(battleId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load battle questions.");
    } finally {
      setBusy(false);
    }
  };

  const submitAnswers = async () => {
    if (!activeBattleId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await submitBattle(activeBattleId, answers);
      setActiveBattleId(null);
      setQuestions([]);
      setNotice(
        result.status === "waiting_for_opponent"
          ? `Submitted ${result.correct_count}/${result.total_questions} correct. Waiting for your opponent.`
          : result.is_draw
            ? `Both players tied on correct answers and time. It’s a draw; you earned ${result.points_earned} ${result.points_earned === 1 ? "point" : "points"}.`
            : result.winner_id === userId
              ? `You won ${result.points_earned} points! Your current win streak is ${result.your_streak}.`
              : `Battle complete. You earned ${result.points_earned} ${result.points_earned === 1 ? "point" : "points"}. Check the results below.`,
      );
      await refreshBattles();
      onActivityRefresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Could not submit battle answers.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (activeBattleId && questions.length) {
    return (
      <section className="battle-workspace">
        <div className="page-head compact">
          <span className="eyebrow">One-on-one · same questions</span>
          <h1>Battle in progress.</h1>
          <p>More correct answers wins; equal scores are decided by faster time.</p>
        </div>
        {questions.map((question) => (
          <article className="battle-question" key={question.id}>
            <h2>
              {question.position}. {question.prompt}
            </h2>
            <div className="answer-list">
              {question.options.map((option, index) => (
                <button
                  type="button"
                  key={`${question.id}-${index}`}
                  className={answers[question.id] === index ? "selected" : ""}
                  onClick={() => setAnswers((current) => ({ ...current, [question.id]: index }))}
                >
                  <i>{String.fromCharCode(65 + index)}</i>
                  <span>{option}</span>
                  <em>{answers[question.id] === index ? "✓" : ""}</em>
                </button>
              ))}
            </div>
          </article>
        ))}
        <div className="battle-submit">
          <span>
            {Object.keys(answers).length} of {questions.length} answered
          </span>
          <Button
            disabled={busy || Object.keys(answers).length !== questions.length}
            onClick={() => void submitAnswers()}
          >
            {busy ? "Submitting…" : "Submit battle"}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="battle-workspace">
      <div className="page-head">
        <span className="eyebrow">One-on-one battle arena</span>
        <h1>Challenge a classmate.</h1>
        <p>
          Same reviewed quiz for both players. Correct answers decide the winner, then faster time.
          Wins build streaks, points, and titles.
        </p>
      </div>
      {error && (
        <p className="app-feedback" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="app-notice" role="status">
          {notice}
        </p>
      )}
      <section className="battle-challenge-panel">
        <div>
          <span className="eyebrow">Your university</span>
          <h2>{university || "Complete your university profile to find players"}</h2>
        </div>
        <label>
          <span>Shared quiz</span>
          <select value={quizId} onChange={(event) => setQuizId(event.target.value)}>
            <option value="">Choose a published quiz</option>
            {quizzes.map((quiz) => (
              <option key={quiz.id} value={quiz.id}>
                {quiz.title} · {quiz.question_count} questions
              </option>
            ))}
          </select>
        </label>
        <label className="search-field">
          <span className="sr-only">Find a player at your university</span>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a player at your university"
          />
        </label>
        {opponents.length ? (
          <div className="battle-opponent-list">
            {opponents.map((opponent) => (
              <article key={opponent.user_id}>
                <span className="avatar">
                  {(opponent.full_name || "S").slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{opponent.full_name || "Student"}</strong>
                  <small>{opponent.university}</small>
                </div>
                <Button disabled={busy || !quizId} onClick={() => void challenge(opponent.user_id)}>
                  Challenge
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <p className="field-note">No active players found at your university.</p>
        )}
      </section>
      <section className="battle-matches">
        <div className="admin-section-heading">
          <div>
            <span className="eyebrow">Live and recent</span>
            <h2>Your challenges</h2>
          </div>
          <Button variant="secondary" disabled={busy} onClick={() => void refreshBattles()}>
            Refresh
          </Button>
        </div>
        {battles.length ? (
          battles.map((battle) => {
            const incoming = battle.challenged_id === userId && battle.status === "pending";
            const outgoing = battle.challenger_id === userId && battle.status === "pending";
            const otherName =
              battle.challenger_id === userId ? battle.challenged_name : battle.challenger_name;
            return (
              <article className="battle-match-row" key={battle.id}>
                <div>
                  <strong>{battle.quiz_title}</strong>
                  <small>
                    {incoming ? `${otherName} challenged you` : `Challenge with ${otherName}`}
                    {" · "}
                    {new Date(battle.created_at).toLocaleDateString()}
                  </small>
                </div>
                <span
                  className={`badge ${battle.status === "completed" ? "badge-purple" : "badge-amber"}`}
                >
                  {battle.status}
                </span>
                {incoming && (
                  <>
                    <Button disabled={busy} onClick={() => void respond(battle.id, true)}>
                      Accept
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void respond(battle.id, false)}
                    >
                      Decline
                    </Button>
                  </>
                )}
                {outgoing && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await cancelBattle(battle.id);
                        await refreshBattles();
                      } catch (cancelError) {
                        setError(
                          cancelError instanceof Error
                            ? cancelError.message
                            : "Could not cancel this challenge.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Cancel
                  </Button>
                )}
                {battle.status === "active" && !battle.your_submission && (
                  <Button disabled={busy} onClick={() => void startBattle(battle.id)}>
                    Play
                  </Button>
                )}
                {battle.status === "active" && battle.your_submission && (
                  <small>Submitted · waiting for your opponent</small>
                )}
                {battle.status === "completed" && (
                  <div className="battle-match-result">
                    <strong>
                      {battle.is_draw ? "Draw" : battle.winner_id === userId ? "Victory" : "Defeat"}
                    </strong>
                    <small>
                      You {battle.your_correct_count ?? 0} correct in{" "}
                      {(battle.your_duration_seconds ?? 0).toFixed(2)}s{" · "}
                      opponent {battle.opponent_correct_count ?? 0} correct in{" "}
                      {(battle.opponent_duration_seconds ?? 0).toFixed(2)}s
                    </small>
                  </div>
                )}
              </article>
            );
          })
        ) : (
          <EmptyState
            title="No challenges yet"
            text="Choose a reviewed quiz and challenge an active student at your university."
          />
        )}
      </section>
    </div>
  );
}

function PaperRow({ paper, onClick }: { paper: Paper; onClick: () => void }) {
  return (
    <button className="paper-row" onClick={onClick}>
      <span className="file-tile">▤</span>
      <span>
        <b>{paper.academic_session}</b>
        <small>
          {paper.semester ?? "Past paper"}
          {paper.exam_year ? ` · ${paper.exam_year}` : ""}
        </small>
      </span>
      <span className="badge badge-green">{paper.is_verified ? "Verified" : "Published"}</span>
      <span aria-hidden="true">›</span>
    </button>
  );
}

function PaperPage({
  paper,
  course,
  quizStatus,
  quizBusy,
  watermark,
  onQuiz,
  onBattle,
}: {
  paper: Paper;
  course: Course;
  quizStatus: PaperQuizAvailability["status"];
  quizBusy: boolean;
  watermark: string;
  onQuiz: () => void;
  onBattle: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPreviewUrl(null);
    setPreviewError(null);
    void getPaperReaderUrl(paper.file_path)
      .then((url) => {
        if (active) setPreviewUrl(url);
      })
      .catch((loadError: unknown) => {
        if (active)
          setPreviewError(
            loadError instanceof Error ? loadError.message : "Could not read the original paper.",
          );
      });
    return () => {
      active = false;
    };
  }, [paper.id, paper.file_path]);

  return (
    <>
      <div className="paper-meta-head">
        <div>
          <span className="badge badge-purple">
            {course.university} · {course.code}
          </span>
          <h1>{paper.academic_session}</h1>
          <p>
            {course.title} · {paper.semester ?? "Past paper"}
          </p>
        </div>
      </div>
      <section className="metadata-card">
        <h3>Document details</h3>
        <dl>
          <div>
            <dt>University</dt>
            <dd>{course.university}</dd>
          </div>
          <div>
            <dt>Course</dt>
            <dd>
              {course.code} · {course.title}
            </dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>{paper.academic_session}</dd>
          </div>
          <div>
            <dt>Pages</dt>
            <dd>{paper.page_count ?? "Not specified"}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{paper.is_verified ? "Verified" : "Published"}</dd>
          </div>
        </dl>
      </section>
      <section className="past-paper-reader" aria-label="Original past paper">
        <div>
          <span className="eyebrow">Original source</span>
          <h2>Read the past paper</h2>
          <p>Unchanged source document. Quiz questions are entered and reviewed separately.</p>
        </div>
        {previewUrl ? (
          <ProtectedDocumentSurface
            src={previewUrl}
            title={`Original ${course.code} past paper`}
            isPdf={/\.pdf(?:$|[?#])/i.test(paper.file_path)}
            watermark={watermark}
          />
        ) : (
          <p
            className={previewError ? "reader-error" : "reader-loading"}
            role={previewError ? "alert" : "status"}
          >
            {previewError || "Loading the source document…"}
          </p>
        )}
      </section>
      <div className="paper-cta">
        <div>
          <h3>Ready to practise?</h3>
          <p>Put your knowledge to work with a reviewed quiz or challenge a classmate in Battle.</p>
        </div>
        <Button
          disabled={
            quizBusy ||
            quizStatus === "loading" ||
            quizStatus === "missing" ||
            quizStatus === "error"
          }
          onClick={onQuiz}
        >
          {quizBusy || quizStatus === "loading"
            ? "Checking quiz…"
            : quizStatus === "ready"
              ? "Take quiz"
              : quizStatus === "missing"
                ? "No quiz available"
                : quizStatus === "error"
                  ? "Quiz check failed"
                  : "Retry quiz check"}
        </Button>
        <Button variant="secondary" onClick={onBattle}>
          Challenge in Battle
        </Button>
      </div>
    </>
  );
}

function SourceDocumentDialog({
  path,
  title,
  watermark,
  onClose,
}: {
  path: string;
  title: string;
  watermark: string;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSrc(null);
    setError(null);
    void getPaperReaderUrl(path)
      .then((url) => {
        if (active) setSrc(url);
      })
      .catch((loadError: unknown) => {
        if (active)
          setError(
            loadError instanceof Error ? loadError.message : "Could not open the original source.",
          );
      });
    return () => {
      active = false;
    };
  }, [path]);

  return (
    <div className="source-dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="source-document-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <strong>{title}</strong>
          <button type="button" onClick={onClose} aria-label="Close source viewer">
            ×
          </button>
        </header>
        {src ? (
          <ProtectedDocumentSurface
            src={src}
            title={title}
            isPdf={/\.pdf(?:$|[?#])/i.test(path)}
            watermark={watermark}
          />
        ) : (
          <p
            className={error ? "reader-error" : "reader-loading"}
            role={error ? "alert" : "status"}
          >
            {error || "Loading the source document…"}
          </p>
        )}
      </section>
    </div>
  );
}

function ProtectedDocumentSurface({
  src,
  title,
  isPdf,
  watermark,
}: {
  src: string;
  title: string;
  isPdf: boolean;
  watermark: string;
}) {
  return (
    <div className="protected-document">
      {isPdf ? <iframe src={src} title={title} /> : <img src={src} alt={title} />}
      <div className="document-watermark" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index}>{watermark} · RIMBLY</span>
        ))}
      </div>
    </div>
  );
}

function QuizPage({
  questions,
  answers,
  busy,
  setAnswer,
  onSubmit,
}: {
  questions: PublicQuestion[];
  answers: Record<string, number>;
  busy: boolean;
  setAnswer: (questionId: string, index: number) => void;
  onSubmit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const question = questions[index];
  const options = Array.isArray(question.options) ? question.options : [];
  const answered = Object.keys(answers).length;
  return (
    <div className="focus-page">
      <header>
        <span>
          Question {index + 1} of {questions.length}
        </span>
        <div className="progress">
          <span style={{ width: `${(answered / questions.length) * 100}%` }} />
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => window.history.back()}>
          Exit
        </button>
      </header>
      <main className="question-wrap">
        <span className="badge badge-purple">{question.position}</span>
        <h1>{question.prompt}</h1>
        <div className="answer-list">
          {options.map((option, choice) => (
            <button
              type="button"
              key={`${question.id}-${choice}`}
              className={answers[question.id] === choice ? "selected" : ""}
              onClick={() => setAnswer(question.id, choice)}
            >
              <i>{String.fromCharCode(65 + choice)}</i>
              <span>{option}</span>
              <em>{answers[question.id] === choice ? "✓" : ""}</em>
            </button>
          ))}
        </div>
      </main>
      <footer>
        <span>
          {answered} of {questions.length} answered
        </span>
        <div>
          {index > 0 && (
            <Button variant="secondary" onClick={() => setIndex(index - 1)}>
              Previous
            </Button>
          )}
          {index < questions.length - 1 ? (
            <Button
              disabled={answers[question.id] === undefined}
              onClick={() => setIndex(index + 1)}
            >
              Next
            </Button>
          ) : (
            <Button disabled={answered === 0 || busy} onClick={onSubmit}>
              {busy ? "Saving…" : "Submit answers"}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function ResultsPage({
  attempt,
  paper,
  onRetry,
  onHistory,
}: {
  attempt: QuizAttempt;
  paper?: Paper;
  onRetry: () => void;
  onHistory: () => void;
}) {
  return (
    <>
      <div className="result-hero">
        <span className="badge badge-green">Quiz saved</span>
        <h1>{attempt.score_percent}%</h1>
        <p>
          {attempt.correct_count} correct out of {attempt.total_questions}
          {attempt.quiz_title
            ? ` · ${attempt.quiz_title}`
            : paper
              ? ` · ${paper.academic_session}`
              : ""}
        </p>
        <div className="xp-pill">
          {Math.round(attempt.duration_seconds / 60)} min · recorded{" "}
          {new Date(attempt.created_at).toLocaleString()}
        </div>
        {attempt.points_earned !== undefined && (
          <div className="xp-pill">{attempt.points_earned} points earned</div>
        )}
      </div>
      <div className="result-actions">
        <Button onClick={onRetry}>Try another quiz</Button>
        <Button variant="secondary" onClick={onHistory}>
          View quiz history
        </Button>
      </div>
    </>
  );
}

function AttemptRow({ attempt, paper }: { attempt: QuizAttempt; paper?: Paper }) {
  return (
    <article className="attempt-row">
      <span
        className={`score-box ${attempt.score_percent >= 80 ? "great" : attempt.score_percent >= 60 ? "good" : "fair"}`}
      >
        {attempt.score_percent}%
      </span>
      <span>
        <b>{attempt.quiz_title ?? paper?.academic_session ?? "Past paper"}</b>
        <small>
          {attempt.correct_count}/{attempt.total_questions} correct ·{" "}
          {Math.ceil(attempt.duration_seconds / 60)} min
        </small>
        <em>{new Date(attempt.created_at).toLocaleString()}</em>
      </span>
    </article>
  );
}

function LeaderRow({ leader, rank, isMe }: { leader: Leader; rank: number; isMe: boolean }) {
  return (
    <div className={`ranking-row ${isMe ? "me" : ""}`}>
      <b>{rank}</b>
      <span className="avatar">
        {leader.full_name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase()}
      </span>
      <span>
        <strong>{leader.full_name || "Student"}</strong>
        <small>
          {leader.university ?? "University not set"} · {leader.title || "Rookie"} ·{" "}
          {leader.quizzes_completed} quizzes
          {leader.current_win_streak ? ` · ${leader.current_win_streak} win streak` : ""}
        </small>
      </span>
      <b>{leader.points.toLocaleString()} pts</b>
    </div>
  );
}

function ContributionPage({
  profile,
  universities,
  busy,
  contributions,
  error,
  onSubmit,
  onClearError,
}: {
  profile: Profile;
  universities: University[];
  busy: boolean;
  contributions: Contribution[];
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClearError: () => void;
}) {
  const [tab, setTab] = useState<"new" | "mine">("new");
  return (
    <>
      <div className="page-head compact">
        <span className="eyebrow">Grow the archive</span>
        <h1>Your papers. Everyone’s edge.</h1>
        <p>Files are uploaded privately and reviewed before they are published.</p>
      </div>
      <div className="segment">
        <button className={tab === "new" ? "active" : ""} onClick={() => setTab("new")}>
          New contribution
        </button>
        <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>
          My contributions ({contributions.length})
        </button>
      </div>
      {tab === "mine" ? (
        contributions.length ? (
          <div className="contribution-list">
            {contributions.map((item) => (
              <article key={item.id}>
                <span className="file-tile">▤</span>
                <span>
                  <b>
                    {item.course_code} · {item.exam_year}
                  </b>
                  <small>
                    {item.course_title} · {new Date(item.created_at).toLocaleDateString()}
                  </small>
                </span>
                <span
                  className={`badge badge-${item.status === "approved" ? "green" : item.status === "rejected" ? "red" : "amber"}`}
                >
                  {item.status}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No submissions yet"
            text="Your contribution status will appear here after you upload a paper."
          />
        )
      ) : (
        <form className="contribution-form" onSubmit={onSubmit}>
          <Feedback error={error} clear={onClearError} />
          <label>
            <span>University</span>
            <select
              name="university"
              required
              defaultValue={profile.university ?? ""}
              disabled={!universities.length}
            >
              <option value="" disabled>
                Select your university
              </option>
              {universities.map((university) => (
                <option key={university.id} value={university.name}>
                  {university.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-two">
            <label>
              <span>Course code</span>
              <input name="course_code" required placeholder="e.g. CSC 301" />
            </label>
            <label>
              <span>Exam year</span>
              <input
                name="exam_year"
                type="number"
                min="1990"
                max={new Date().getFullYear()}
                required
              />
            </label>
          </div>
          <label>
            <span>Course title</span>
            <input name="course_title" required />
          </label>
          <label className="upload-area">
            <input
              name="file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              required
            />
            <b>Upload PDF or image</b>
            <small>PDF, JPG or PNG · Up to 20 MB</small>
          </label>
          <label>
            <span>Notes (optional)</span>
            <textarea name="notes" />
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? "Uploading…" : "Submit for review"}
          </Button>
        </form>
      )}
    </>
  );
}

export default App;
