import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AppNotification,
  AdminAccess,
  AdminActivationMetrics,
  AdminAuditLog,
  AdminContribution,
  archiveAdminQuizSet,
  AdminQuizPaper,
  AdminQuizSet,
  AdminPaper,
  AdminPaperUpdateInput,
  AdminOverview,
  AdminStudent,
  AdminTeamMember,
  AdminAmbassador,
  AmbassadorDashboard,
  MaintenanceStatus,
  RimblyBillingStatus,
  QuizAttemptReviewItem,
  Contribution,
  Battle,
  Course,
  GameProgress,
  DailyChallengeLeader,
  GuestExploreCatalog,
  OpenBattleInvite,
  UniversityBattleActivity,
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
  getAdminActivationMetrics,
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
  removeAdminPaperFile,
  recordReviewedQuizActivation,
  getAmbassadorDashboard,
  agreeToAmbassadorTerms,
  getAdminAmbassadors,
  setAdminAmbassadorStatus,
  getMaintenanceStatus,
  deleteAdminPaper,
  takeOverAdminQuizDraft,
  inviteAdmin,
  publishAdminPaper,
  publishAdminQuiz,
  uploadAdminPaperReplacement,
  updateAdminPaper,
  saveAdminQuizDraft,
  requestAdminQuizReview,
  reviewAdminQuiz,
  saveAdminUniversity,
  setMaintenanceStatus,
  setAdminStudentSuspension,
  updateAdminTeamMember,
  getLeaderboard,
  getDailyChallengeLeaderboard,
  getGameProgress,
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
  createOpenBattleChallenge,
  getBattles,
  getUniversityBattleActivity,
  getOpenBattleChallenge,
  acceptOpenBattleChallenge,
  respondToBattle,
  cancelBattle,
  getBattleQuestions,
  submitBattle,
  getUniversities,
  getQuizAttempts,
  getGuestExploreCatalog,
  getSavedCourseIds,
  markNotificationsRead,
  saveProfile,
  reviewAdminContribution,
  toggleSavedCourse,
  getMyRimblyBillingStatus,
  getQuizAttemptReview,
} from "./lib/data";
import { supabase, supabaseConfigurationError } from "./lib/supabase";
import { rimblyProPlans, RimblyPlanId } from "./lib/monetization";

type Route =
  | "welcome"
  | "signup"
  | "login"
  | "forgot-password"
  | "verify-email"
  | "reset-password"
  | "explore"
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
  | "ambassador"
  | "profile"
  | "subscription"
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
  "forgot-password",
  "verify-email",
  "reset-password",
  "explore",
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
  "ambassador",
  "profile",
  "subscription",
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

const pendingBattleInviteStorageKey = "rimbly-pending-battle-invite";
const pendingReferralCodeStorageKey = "rimbly-pending-referral-code";
const postSignupRouteStorageKey = "rimbly-post-signup-route";

const pendingReferralCodeFromLocation = () => {
  const referralCode = new URLSearchParams(window.location.search).get("ref")?.trim().toUpperCase();
  if (referralCode && /^[A-F0-9]{10}$/.test(referralCode)) {
    window.sessionStorage.setItem(pendingReferralCodeStorageKey, referralCode);
    return referralCode;
  }
  return window.sessionStorage.getItem(pendingReferralCodeStorageKey);
};

const routeUrl = (route: Route) => {
  const search = new URLSearchParams({ route });
  const pendingBattleId = window.sessionStorage.getItem(pendingBattleInviteStorageKey);
  if (pendingBattleId) search.set("challenge", pendingBattleId);
  return `${window.location.origin}/?${search.toString()}`;
};

const pendingBattleInviteFromLocation = () => {
  const challengeId = new URLSearchParams(window.location.search).get("challenge");
  if (challengeId) {
    window.sessionStorage.setItem(pendingBattleInviteStorageKey, challengeId);
    return challengeId;
  }
  return window.sessionStorage.getItem(pendingBattleInviteStorageKey);
};

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
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  name?: string;
  value?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      className={`btn btn-${variant}`}
      type={type}
      onClick={onClick}
      disabled={disabled}
      name={name}
      value={value}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button className="logo" onClick={onClick} aria-label="Rimbly home">
      <span className="logo-mark" aria-hidden="true">
        <img src="/rimbly-icon.png" alt="" />
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
      {action && onAction && <Button onClick={onAction}>{action}</Button>}
    </div>
  );
}

function LoadingCards({ label, count = 3 }: { label: string; count?: number }) {
  return (
    <div className="loading-card-list" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <span className="loading-card-skeleton" key={index} />
      ))}
    </div>
  );
}

function FirstSessionGuide({
  quiz,
  onStart,
  onBrowse,
  onBattle,
  onDismiss,
}: {
  quiz: QuizSet | null;
  onStart: () => void;
  onBrowse: () => void;
  onBattle: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="first-session-guide" aria-labelledby="first-session-title">
      <div>
        <span className="eyebrow">Your first study session</span>
        <h2 id="first-session-title">
          {quiz ? `Start with ${quiz.title}.` : "Your study space is ready."}
        </h2>
        <p>
          {quiz
            ? "We picked a reviewed quiz to help you get started. Your score and progress will be saved."
            : "Browse reviewed quizzes, then come back to track your daily practice and streak."}
        </p>
      </div>
      <ol aria-label="Getting started">
        <li>
          <span>1</span>Take one reviewed quiz
        </li>
        <li>
          <span>2</span>Review your score and answers
        </li>
        <li>
          <span>3</span>Try a university battle when you’re ready
        </li>
      </ol>
      <div className="home-preview-ghost" aria-label="Preview of your progress after you practise">
        <div>
          <strong>1 reviewed quiz</strong>
          <small>Your first study win</small>
        </div>
        <div>
          <strong>Score + review</strong>
          <small>See what you know</small>
        </div>
        <div>
          <strong>Progress saved</strong>
          <small>Build from here</small>
        </div>
      </div>
      <div className="first-session-actions">
        <Button onClick={quiz ? onStart : onBrowse}>
          {quiz ? "Start recommended quiz" : "Browse reviewed quizzes"}
        </Button>
        <button type="button" className="text-button" onClick={onBattle}>
          Explore Battle
        </button>
        <button type="button" className="guide-skip" onClick={onDismiss}>
          Skip this guide
        </button>
      </div>
    </section>
  );
}

function QuizPreview({ onCreateAccount }: { onCreateAccount: () => void }) {
  const sampleQuestions = [
    {
      prompt: "Solve for x: 3x − 5 = 16.",
      options: ["7", "9", "11", "12"],
      correctIndex: 0,
      explanation: "Add 5 to both sides, then divide by 3: x = 21 ÷ 3 = 7.",
    },
    {
      prompt: "A class has 40 students. If 25% are absent, how many are present?",
      options: ["10", "25", "30", "35"],
      correctIndex: 2,
      explanation: "25% of 40 is 10 absent, so 40 − 10 = 30 students are present.",
    },
  ];
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const question = sampleQuestions[questionIndex];
  const score = sampleQuestions.reduce(
    (total, sample, index) => total + Number(answers[index] === sample.correctIndex),
    0,
  );
  const reset = () => {
    setQuestionIndex(0);
    setAnswers({});
    setSubmitted(false);
  };

  return (
    <section className="quiz-preview" aria-label="Interactive sample quiz">
      <div className="quiz-preview-heading">
        <span className="eyebrow">Exam-style sample</span>
        <span className="badge badge-purple">
          Question {questionIndex + 1} of {sampleQuestions.length}
        </span>
      </div>
      <h3>{question.prompt}</h3>
      <div className="quiz-preview-options">
        {question.options.map((option, index) => (
          <button
            type="button"
            className={answers[questionIndex] === index ? "selected" : ""}
            aria-pressed={answers[questionIndex] === index}
            key={option}
            onClick={() => {
              setAnswers((current) => ({ ...current, [questionIndex]: index }));
              setSubmitted(false);
            }}
          >
            <span>{String.fromCharCode(65 + index)}</span>
            {option}
          </button>
        ))}
      </div>
      {submitted && (
        <div className="quiz-preview-review" role="status">
          <p className="quiz-preview-result">
            {score === sampleQuestions.length
              ? "Perfect sample score"
              : `${score} of ${sampleQuestions.length} correct`}
            {" · "}Here’s the answer review:
          </p>
          {sampleQuestions.map((sample, index) => (
            <p className="quiz-preview-explanation" key={sample.prompt}>
              <strong>
                {answers[index] === sample.correctIndex ? "✓" : "Review"} Question {index + 1}:
              </strong>{" "}
              {sample.explanation}
            </p>
          ))}
          <Button onClick={onCreateAccount}>Create an account to take a reviewed quiz</Button>
        </div>
      )}
      <div className="quiz-preview-actions">
        {submitted ? (
          <Button variant="secondary" onClick={reset}>
            Try again
          </Button>
        ) : questionIndex > 0 ? (
          <Button variant="secondary" onClick={() => setQuestionIndex((current) => current - 1)}>
            Previous
          </Button>
        ) : null}
        {submitted ? null : questionIndex < sampleQuestions.length - 1 ? (
          <Button
            disabled={answers[questionIndex] === undefined}
            onClick={() => setQuestionIndex((current) => current + 1)}
          >
            Next question
          </Button>
        ) : (
          <Button
            disabled={Object.keys(answers).length !== sampleQuestions.length}
            onClick={() => setSubmitted(true)}
          >
            See sample score
          </Button>
        )}
      </div>
    </section>
  );
}

function GuestExplorePage({
  configured,
  onNavigate,
}: {
  configured: boolean;
  onNavigate: (route: Route) => void;
}) {
  const [catalog, setCatalog] = useState<GuestExploreCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [university, setUniversity] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    if (!configured) {
      setError("Guest Explore is unavailable until the database is configured.");
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError(null);
    void getGuestExploreCatalog()
      .then((result) => {
        if (active) setCatalog(result);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load the course catalog.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [configured, reloadKey]);

  const universities = [
    ...new Set(catalog?.courses.map((course) => course.university).filter(Boolean) ?? []),
  ].sort((first, second) => first.localeCompare(second));
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const courses = (catalog?.courses ?? []).filter((course) => {
    const matchesSearch =
      `${course.code} ${course.title} ${course.university} ${course.department ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedSearch);
    return matchesSearch && (!university || course.university === university);
  });
  const quizzes = (catalog?.quizzes ?? []).filter((quiz) => {
    const matchesSearch =
      `${quiz.title} ${quiz.course_code ?? ""} ${quiz.course_title ?? ""} ${quiz.university ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedSearch);
    return matchesSearch && (!university || quiz.university === university);
  });

  return (
    <div className="guest-explore-page">
      <header className="guest-explore-header">
        <Logo onClick={() => onNavigate("welcome")} />
        <div>
          <Button variant="secondary" onClick={() => onNavigate("login")}>
            Sign in
          </Button>
          <Button onClick={() => onNavigate("signup")}>Join free</Button>
        </div>
      </header>
      <main className="app-main guest-explore-main">
        <div className="page-head">
          <span className="eyebrow">Explore without an account</span>
          <h1>Find your next practice.</h1>
          <p>Browse course coverage and reviewed quizzes before you join.</p>
        </div>
        <QuizPreview onCreateAccount={() => onNavigate("signup")} />
        <label className="search-field guest-explore-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search course, department, or university"
            aria-label="Search courses and quizzes"
          />
        </label>
        <label className="guest-university-filter">
          <span>University</span>
          <select value={university} onChange={(event) => setUniversity(event.target.value)}>
            <option value="">All universities</option>
            {universities.map((name) => (
              <option value={name} key={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <div className="app-feedback" role="alert">
            <span>{error}</span>
            {configured && (
              <Button variant="secondary" onClick={() => setReloadKey((current) => current + 1)}>
                Try again
              </Button>
            )}
          </div>
        )}
        {loading ? (
          <section className="guest-catalog-section" aria-label="Loading public course catalog">
            <div className="section-title">
              <div>
                <span>Course coverage</span>
                <h2>Courses in the library</h2>
              </div>
            </div>
            <div className="guest-course-skeletons" role="status">
              <span />
              <span />
              <span />
            </div>
          </section>
        ) : catalog ? (
          <>
            <section className="guest-catalog-section">
              <div className="section-title">
                <div>
                  <span>
                    {quizzes.length} reviewed {quizzes.length === 1 ? "quiz" : "quizzes"}
                  </span>
                  <h2>Try a full quiz after joining</h2>
                </div>
              </div>
              {quizzes.length ? (
                <div className="guest-quiz-list">
                  {quizzes.map((quiz) => (
                    <article className="guest-quiz-card" key={quiz.id}>
                      <span className="badge badge-green">Reviewed quiz</span>
                      <h3>{quiz.title}</h3>
                      <p>
                        {[quiz.course_code, quiz.course_title, quiz.university]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <small>{quiz.question_count} approved questions</small>
                      <Button onClick={() => onNavigate("signup")}>Join to practise</Button>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No reviewed quizzes match yet"
                  text="Try another search or browse courses while the reviewed quiz library grows."
                />
              )}
            </section>
            <section className="guest-catalog-section">
              <div className="section-title">
                <div>
                  <span>
                    {courses.length} {courses.length === 1 ? "course" : "courses"}
                  </span>
                  <h2>Courses in the library</h2>
                </div>
              </div>
              {courses.length ? (
                <div className="guest-course-list">
                  {courses.map((course) => (
                    <article className="guest-course-card" key={course.id}>
                      <div className="guest-course-heading">
                        <strong>{course.code}</strong>
                        <span className={`badge ${course.is_verified ? "badge-green" : ""}`}>
                          {course.is_verified ? "Verified listing" : "Course listing"}
                        </span>
                      </div>
                      <h3>{course.title}</h3>
                      <p>
                        {[course.university, course.department, course.level]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <div className="guest-course-meta">
                        <span>
                          {course.paper_count}{" "}
                          {course.paper_count === 1 ? "approved paper" : "approved papers"}
                        </span>
                        {course.has_reviewed_quiz && (
                          <span className="badge badge-purple">Quiz ready</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No courses match this search"
                  text="Try another course, department, or university."
                  action="Clear search"
                  onAction={() => {
                    setSearch("");
                    setUniversity("");
                  }}
                />
              )}
            </section>
          </>
        ) : null}
        <section className="guest-explore-cta">
          <div>
            <span className="eyebrow">Ready to make it count?</span>
            <h2>Save your scores and build a study streak.</h2>
          </div>
          <Button onClick={() => onNavigate("signup")}>Create a free account</Button>
        </section>
      </main>
    </div>
  );
}

function AppShell({
  route,
  title,
  adminAvailable,
  ambassadorAvailable,
  onNavigate,
  children,
}: {
  route: Route;
  title: string;
  adminAvailable: boolean;
  ambassadorAvailable: boolean;
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
              aria-current={route === item.route ? "page" : undefined}
              onClick={() => onNavigate(item.route)}
            >
              <Icon>{item.icon}</Icon>
              {item.label}
            </button>
          ))}
          {ambassadorAvailable && (
            <button
              className={route === "ambassador" ? "active" : ""}
              aria-current={route === "ambassador" ? "page" : undefined}
              onClick={() => onNavigate("ambassador")}
            >
              <Icon>★</Icon>
              Ambassador
            </button>
          )}
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
              aria-current={route === item.route ? "page" : undefined}
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
  onNavigate,
  onClearError,
  configured,
}: {
  mode: "signup" | "login";
  busy: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
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
              : "Start with email and password. Add your university after you sign in."}
          </p>
        </div>
        <Feedback error={error} clear={onClearError} />
        <form onSubmit={onSubmit} className="form-stack">
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
            <button className="forgot" type="button" onClick={() => onNavigate("forgot-password")}>
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

function ForgotPasswordPage({
  busy,
  error,
  notice,
  onSubmit,
  onNavigate,
  onClearError,
  configured,
}: {
  busy: boolean;
  error: string | null;
  notice: string | null;
  onSubmit: (email: string) => void;
  onNavigate: (route: Route) => void;
  onClearError: () => void;
  configured: boolean;
}) {
  const [email, setEmail] = useState("");
  return (
    <div className="auth-form-page">
      <div className="auth-form-wrap">
        <div className="auth-form-head">
          <Logo onClick={() => onNavigate("welcome")} />
        </div>
        <div className="auth-copy">
          <span className="eyebrow">Account recovery</span>
          <h1>Forgot your password?</h1>
          <p>Enter the email address on your account and we’ll send you a secure reset link.</p>
        </div>
        <Feedback error={error} clear={onClearError} />
        {notice && (
          <p className="app-notice" role="status">
            {notice}
          </p>
        )}
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(email.trim());
          }}
        >
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
          <Button type="submit" disabled={busy || !configured}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
        <p className="auth-switch">
          Remembered it?{" "}
          <button type="button" onClick={() => onNavigate("login")}>
            Back to sign in
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
        <Button variant="secondary" onClick={() => onNavigate("explore")}>
          Explore courses while you wait
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
            <img src="/rimbly-icon.png" alt="" />
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
  hasReviewedQuiz = false,
  onClick,
}: {
  course: Course;
  paperCount: number;
  hasReviewedQuiz?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="course-card" onClick={onClick}>
      <span className="course-icon tone-purple">
        <Icon>▤</Icon>
      </span>
      <span className="course-copy">
        <span className="course-tags">
          <span className="badge badge-purple">{course.university}</span>
          {course.department && <span className="badge">{course.department}</span>}
          {course.is_verified && <span className="badge badge-green">Verified course</span>}
        </span>
        <strong>{course.code}</strong>
        <small>{course.title}</small>
        <span className="course-readiness-row">
          {hasReviewedQuiz ? (
            <span className="badge badge-green">Reviewed quiz ready</span>
          ) : (
            <strong className="course-readiness-state">
              {paperCount ? "Past papers only" : "No study materials yet"}
            </strong>
          )}
          <em>
            {paperCount} approved {paperCount === 1 ? "paper" : "papers"}
          </em>
        </span>
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

function sortCoursesForProfile(
  courses: Course[],
  profile: Profile | null,
  papers: Paper[],
  quizzes: QuizSet[],
) {
  const quizPaperIds = new Set(
    quizzes.map((quiz) => quiz.paper_id).filter((paperId): paperId is string => paperId !== null),
  );
  const quizReadyCourseIds = new Set(
    papers.filter((paper) => quizPaperIds.has(paper.id)).map((paper) => paper.course_id),
  );
  return [...courses].sort(
    (first, second) =>
      Number(quizReadyCourseIds.has(second.id)) - Number(quizReadyCourseIds.has(first.id)) ||
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

function courseHasReviewedQuiz(course: Course, papers: Paper[], quizzes: QuizSet[]) {
  const coursePaperIds = new Set(
    papers.filter((paper) => paper.course_id === course.id).map((paper) => paper.id),
  );
  return quizzes.some((quiz) => quiz.paper_id !== null && coursePaperIds.has(quiz.paper_id));
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
      <span className="quiz-card-mark" aria-hidden="true">
        ✦
      </span>
      <div className="quiz-card-copy">
        {courseLabel && <span className="quiz-card-course">{courseLabel}</span>}
        <h2>{quiz.title}</h2>
        <p>{quiz.description || "Reviewed practice questions"}</p>
        <div className="quiz-card-meta">
          <span className="badge badge-green">Reviewed questions</span>
          <small className="quiz-audience-meta">
            {[
              departments.join(" / ") || "General",
              quiz.audience_level,
              universities.join(" / ") || "University context not provided",
            ]
              .filter(Boolean)
              .join(" · ")}
          </small>
          {quiz.source_file_path && (
            <button type="button" className="quiz-source-link" onClick={onReadSource}>
              Read source: {quiz.source_file_name ?? "Source paper"}
            </button>
          )}
        </div>
      </div>
      <div className="quiz-card-actions">
        <span className="quiz-card-question-count">{quiz.question_count} questions</span>
        <Button disabled={busy} onClick={onTake} ariaLabel={`Start quiz: ${quiz.title}`}>
          {busy ? "Loading…" : "Start quiz"}
          <span aria-hidden="true">→</span>
        </Button>
      </div>
    </article>
  );
}

function QuizSetupPage({
  quizzes,
  courses,
  loading,
  busy,
  onTake,
  onReadSource,
  onRefresh,
  onBrowseCourses,
}: {
  quizzes: QuizSet[];
  courses: Course[];
  loading: boolean;
  busy: boolean;
  onTake: (quizId: string) => void;
  onReadSource: (path: string, title: string) => void;
  onRefresh: () => void;
  onBrowseCourses: () => void;
}) {
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [faculty, setFaculty] = useState("");
  const [department, setDepartment] = useState("");
  const quizEntries = useMemo(
    () =>
      quizzes.map((quiz) => {
        const courseCode = normalizeCatalogLabel(quiz.course_code);
        const matchingCourses = courseCode
          ? courses.filter((course) => normalizeCatalogLabel(course.code) === courseCode)
          : [];
        const course =
          matchingCourses.find(
            (item) =>
              normalizeCatalogLabel(item.university) ===
              normalizeCatalogLabel(quiz.university ?? quiz.audience_university),
          ) ?? matchingCourses[0];
        const departments = [quiz.audience_department, quiz.course_department, course?.department]
          .filter((value): value is string => Boolean(value))
          .filter((value, index, values) => values.indexOf(value) === index);
        const levels = [quiz.audience_level, course?.level]
          .filter((value): value is string => Boolean(value))
          .filter((value, index, values) => values.indexOf(value) === index);
        return { quiz, course, departments, levels };
      }),
    [quizzes, courses],
  );
  const levels = Array.from(new Set(quizEntries.flatMap((entry) => entry.levels))).sort((a, b) =>
    a.localeCompare(b),
  );
  const faculties = Array.from(
    new Set(courses.map((course) => course.faculty).filter((value): value is string => !!value)),
  ).sort((a, b) => a.localeCompare(b));
  const departments = Array.from(new Set(quizEntries.flatMap((entry) => entry.departments))).sort(
    (a, b) => a.localeCompare(b),
  );
  const displayed = quizEntries.filter(
    ({ quiz, course, levels: quizLevels, departments: quizDepartments }) => {
      const matchesSearch =
        `${quiz.course_code ?? ""} ${quiz.course_title ?? ""} ${quiz.title} ${quiz.description} ${quiz.university ?? ""} ${quiz.audience_university ?? ""} ${quizDepartments.join(" ")}`
          .toLowerCase()
          .includes(search.trim().toLowerCase());
      return (
        matchesSearch &&
        (!level || quizLevels.includes(level)) &&
        (!faculty || course?.faculty === faculty) &&
        (!department || quizDepartments.includes(department))
      );
    },
  );
  const hasFilters = Boolean(search.trim() || level || faculty || department);
  const clearFilters = () => {
    setSearch("");
    setLevel("");
    setFaculty("");
    setDepartment("");
  };

  return (
    <>
      <div className="page-head compact">
        <span className="eyebrow">Published quizzes</span>
        <h1>Choose your challenge.</h1>
        <p>
          Your department and university matches appear first, but all published quizzes remain
          available. A moderator approves each question before it goes live.
        </p>
      </div>
      <label className="search-field">
        <span aria-hidden="true">⌕</span>
        <input
          aria-label="Search quizzes by course code, title, department, or university"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search course code, title, department, or university"
        />
      </label>
      <div className="practice-filters" role="group" aria-label="Filter quizzes">
        <label>
          <span>Level</span>
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">All levels</option>
            {levels.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Faculty</span>
          <select value={faculty} onChange={(event) => setFaculty(event.target.value)}>
            <option value="">All faculties</option>
            {faculties.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Department</span>
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="">All departments</option>
            {departments.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        {hasFilters && (
          <button type="button" className="clear-filters" onClick={clearFilters}>
            Clear filters
          </button>
        )}
        {hasFilters && (
          <div className="practice-filter-chips" aria-label="Active quiz filters">
            {search.trim() && (
              <button type="button" onClick={() => setSearch("")}>
                Search: {search.trim()} <span aria-hidden="true">×</span>
              </button>
            )}
            {level && (
              <button type="button" onClick={() => setLevel("")}>
                {level} <span aria-hidden="true">×</span>
              </button>
            )}
            {faculty && (
              <button type="button" onClick={() => setFaculty("")}>
                {faculty} <span aria-hidden="true">×</span>
              </button>
            )}
            {department && (
              <button type="button" onClick={() => setDepartment("")}>
                {department} <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
        )}
      </div>
      <section>
        <div className="section-title">
          <div>
            <span aria-live="polite" aria-atomic="true">
              {displayed.length} {displayed.length === 1 ? "quiz" : "quizzes"}
            </span>
            <h2>Published quizzes</h2>
          </div>
        </div>
        {loading ? (
          <LoadingCards label="Loading published quizzes" />
        ) : displayed.length ? (
          <div className="course-list quiz-catalog-grid">
            {displayed.map(({ quiz }) => (
              <QuizCatalogCard
                key={quiz.id}
                quiz={quiz}
                busy={busy}
                onTake={() => onTake(quiz.id)}
                onReadSource={() => {
                  if (quiz.source_file_path) {
                    onReadSource(quiz.source_file_path, `Original source: ${quiz.title}`);
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title={hasFilters ? "No matching quizzes" : "No published quizzes found"}
            text={
              hasFilters
                ? "Try changing or clearing your filters to see more quizzes."
                : "A quiz appears after a reviewer approves at least one question with an answer key."
            }
            action={hasFilters ? "Clear filters" : "Browse past questions"}
            onAction={hasFilters ? clearFilters : onBrowseCourses}
          />
        )}
        {!loading && !quizzes.length && !hasFilters && (
          <div className="admin-actions">
            <Button variant="secondary" disabled={loading} onClick={onRefresh}>
              Refresh quizzes
            </Button>
          </div>
        )}
      </section>
    </>
  );
}

function DailyGoalCard({
  status,
  progress,
  loading,
  error,
  hasQuiz,
  showAction = true,
  onQuiz,
  onPlans,
}: {
  status: RimblyBillingStatus | null;
  progress: GameProgress | null;
  loading: boolean;
  error: string | null;
  hasQuiz: boolean;
  showAction?: boolean;
  onQuiz: () => void;
  onPlans: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const didPractice = status?.did_practice_today ?? false;
  const quizRemaining = status
    ? Math.max(0, status.free_quiz_limit - status.quizzes_used_today)
    : null;
  const battleRemaining = status
    ? Math.max(0, status.free_battle_limit - status.battle_invites_used_today)
    : null;
  const nextReset = new Date(now);
  nextReset.setUTCHours(24, 0, 0, 0);
  const minutesUntilReset = Math.max(0, Math.ceil((nextReset.getTime() - now) / 60_000));
  const resetTime = `${Math.floor(minutesUntilReset / 60)}h ${minutesUntilReset % 60}m`;
  const isEvening = new Date(now).getHours() >= 18;
  const isProtectingStreak = (progress?.current_daily_streak ?? 0) > 0;
  const nextMilestone = [3, 7, 14, 30].find(
    (milestone) => milestone > (progress?.best_daily_streak ?? 0),
  );
  const milestoneProgress = nextMilestone
    ? Math.min(100, ((progress?.current_daily_streak ?? 0) / nextMilestone) * 100)
    : 100;

  return (
    <section
      className={`daily-goal-card ${didPractice ? "completed" : ""} ${progress?.current_daily_streak ? "streak-active" : ""}`}
    >
      <div className="daily-goal-main">
        <span className="daily-goal-icon" aria-hidden="true">
          {didPractice ? "✓" : progress?.current_daily_streak ? "🔥" : "✦"}
          {progress?.current_daily_streak ? (
            <strong>{progress.current_daily_streak}</strong>
          ) : !didPractice && progress ? (
            <small>DAY 1</small>
          ) : null}
        </span>
        <div>
          <span className="eyebrow">{didPractice ? "Daily goal complete" : "Your daily goal"}</span>
          <h2>
            {didPractice
              ? "You showed up for yourself today."
              : progress?.current_daily_streak
                ? "Keep your study streak alive today."
                : progress?.best_daily_streak
                  ? "Restart your streak with one quiz today."
                  : "Start your first study streak today."}
          </h2>
          <p>
            {progress && progress.current_daily_streak > 0
              ? didPractice
                ? `Your ${progress.current_daily_streak}-day streak is safe. Come back tomorrow to keep it growing.`
                : `One reviewed quiz today protects your ${progress.current_daily_streak}-day streak.`
              : didPractice
                ? "You’ve started your streak. Come back tomorrow to make it two days."
                : progress?.best_daily_streak
                  ? "Start a new streak today: one reviewed quiz logs day one and shows your score with answer review."
                  : "Your first streak starts today: finish a reviewed quiz to see your score, review answers and log day one."}
          </p>
          {isEvening && isProtectingStreak && !didPractice && (
            <p className="daily-streak-warning" role="status">
              A gentle reminder: one practice session before midnight keeps your streak going.
            </p>
          )}
        </div>
      </div>
      {progress && (
        <div className="daily-streak-milestones">
          <div className="daily-streak-milestone-label">
            <strong>
              {nextMilestone ? `${nextMilestone}-day reward` : "All daily streak rewards unlocked"}
            </strong>
            <span>
              {nextMilestone
                ? `${Math.max(0, nextMilestone - progress.current_daily_streak)} days to go`
                : "3 · 7 · 14 · 30 days"}
            </span>
          </div>
          <div
            className="daily-streak-track"
            role="progressbar"
            aria-label={
              nextMilestone
                ? `Progress to ${nextMilestone}-day streak reward`
                : "All streak rewards unlocked"
            }
            aria-valuemin={0}
            aria-valuemax={nextMilestone ?? 30}
            aria-valuenow={Math.min(progress.current_daily_streak, nextMilestone ?? 30)}
          >
            <span style={{ width: `${milestoneProgress}%` }} />
          </div>
          <div className="daily-streak-badges" aria-label="Daily streak rewards">
            {[3, 7, 14, 30].map((days) => (
              <span className={progress.best_daily_streak >= days ? "earned" : ""} key={days}>
                {days} days{progress.best_daily_streak >= days ? " ✓" : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="daily-goal-footer">
        <div className="daily-goal-allowances" aria-label="Today's free allowances">
          {loading ? (
            <span className="daily-goal-usage" role="status">
              Loading today’s allowance…
            </span>
          ) : status ? (
            <>
              <span className="daily-goal-usage">
                {status.is_pro
                  ? `Quizzes: ${status.quizzes_used_today} used today`
                  : `Quizzes: ${status.quizzes_used_today}/${status.free_quiz_limit} used · ${quizRemaining} left`}
              </span>
              <span className="daily-goal-usage">
                {status.is_pro
                  ? `Battles: ${status.battle_invites_used_today} invites today`
                  : `Battles: ${status.battle_invites_used_today}/${status.free_battle_limit} invites · ${battleRemaining} left`}
              </span>
              <span className="daily-goal-usage daily-goal-reset">Resets in {resetTime} UTC</span>
            </>
          ) : (
            <button type="button" className="daily-goal-usage-link" onClick={onPlans}>
              {error ? "Usage unavailable · Check plans" : "See your daily limits"}
            </button>
          )}
        </div>
        {showAction && (
          <div className="daily-goal-actions">
            <Button onClick={onQuiz}>
              {didPractice
                ? "Take another quiz"
                : hasQuiz
                  ? "Start today’s quiz"
                  : "Browse quizzes"}
            </Button>
          </div>
        )}
      </div>
      {error && !status && (
        <small className="daily-goal-error" role="status">
          Usage could not load: {error}
        </small>
      )}
      {didPractice && status && !status.is_pro && (
        <small className="daily-goal-bonus" role="status">
          Daily goal bonus unlocked: one extra free quiz today.
        </small>
      )}
    </section>
  );
}

function DailyChallengeCard({
  quiz,
  leaders,
  leadersLoading,
  leadersError,
  userId,
  onStart,
}: {
  quiz: QuizSet | null;
  leaders: DailyChallengeLeader[];
  leadersLoading: boolean;
  leadersError: string | null;
  userId: string;
  onStart: () => void;
}) {
  const myRank = leaders.findIndex((leader) => leader.user_id === userId);

  return (
    <section className="daily-challenge-card">
      <div className="daily-challenge-heading">
        <div>
          <span className="eyebrow">Same questions for everyone today</span>
          <h2>Daily challenge</h2>
        </div>
        <span className="daily-challenge-mark" aria-hidden="true">
          ✦
        </span>
      </div>
      {quiz ? (
        <>
          <div className="daily-challenge-copy">
            <strong>{quiz.title}</strong>
            <span>
              {quiz.course_code ? `${quiz.course_code} · ` : ""}
              10 questions · Challenge changes at 00:00 UTC
            </span>
          </div>
          <div className="daily-challenge-action">
            <Button variant="secondary" onClick={onStart}>
              Take today’s challenge
            </Button>
            {myRank >= 0 && (
              <span>
                You’re #{myRank + 1} today · {leaders[myRank].correct_count}/
                {leaders[myRank].total_questions} correct
              </span>
            )}
          </div>
          <div className="daily-challenge-board">
            <strong>Today’s leaderboard</strong>
            {leadersError ? (
              <p className="daily-challenge-error" role="alert">
                Leaderboard unavailable: {leadersError}
              </p>
            ) : leadersLoading ? (
              <p className="field-note" role="status">
                Loading today’s scores…
              </p>
            ) : leaders.length ? (
              leaders.slice(0, 3).map((leader, index) => (
                <div
                  className={`daily-challenge-leader ${leader.user_id === userId ? "me" : ""}`}
                  key={leader.user_id}
                >
                  <span>
                    #{index + 1} · {leader.full_name || "Student"}
                    {leader.user_id === userId ? " (you)" : ""}
                  </span>
                  <strong>
                    {leader.correct_count}/{leader.total_questions}
                  </strong>
                </div>
              ))
            ) : (
              <p className="field-note">Be the first to post a score today.</p>
            )}
          </div>
        </>
      ) : (
        <p className="field-note">
          Today’s challenge will appear when a quiz with at least 10 reviewed questions is
          available.
        </p>
      )}
    </section>
  );
}

function CampusActivityCard({
  university,
  leaders,
  loading,
  error,
  userId,
}: {
  university: string | null;
  leaders: Leader[];
  loading: boolean;
  error: string | null;
  userId: string;
}) {
  const myRank = leaders.findIndex((leader) => leader.user_id === userId);

  return (
    <section className="campus-activity-card" aria-live="polite">
      <span className="eyebrow">Your campus this week</span>
      {error ? (
        <p role="status">Campus activity is unavailable right now.</p>
      ) : loading ? (
        <p role="status">Checking this week’s university rankings…</p>
      ) : leaders.length ? (
        <p>
          {myRank >= 0
            ? `You’re #${myRank + 1} at ${university} this week. ${leaders.length} students have earned points so far.`
            : `${leaders.length} students at ${university} have earned points this week. Join them with a practice session.`}
        </p>
      ) : (
        <p>No one from {university ?? "your university"} has scored this week yet. Be the first.</p>
      )}
    </section>
  );
}

function UniversityBattleActivityCard({
  university,
  activity,
  loading,
  error,
}: {
  university: string | null;
  activity: UniversityBattleActivity | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="battle-social-proof" aria-live="polite">
      <span className="eyebrow">{university || "Your university"} · last 7 days</span>
      {error ? (
        <p>Recent university battle activity is unavailable right now.</p>
      ) : loading ? (
        <p role="status">Checking recent university battles…</p>
      ) : (
        <>
          {activity?.completed_battles_this_week !== null &&
          activity?.completed_battles_this_week !== undefined ? (
            <p>
              <strong>{activity.completed_battles_this_week} battles</strong> completed at your
              university recently. Start one with a classmate or share a link for later.
            </p>
          ) : activity?.recent_battles.length ? (
            <p>Recent students at your university have started finishing battles together.</p>
          ) : (
            <p>
              Every campus battle starts somewhere. Create a shareable invite and be among the first
              students to finish one this week.
            </p>
          )}
          {activity?.recent_battles.length ? (
            <ol className="battle-social-proof-list">
              {activity.recent_battles.map((battle) => (
                <li key={`${battle.quiz_title}-${battle.completed_at}`}>
                  <span>{battle.quiz_title}</span>
                  <small>{new Date(battle.completed_at).toLocaleDateString()}</small>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </section>
  );
}

function WeeklyResetNote() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const reset = new Date(now);
  const daysUntilMonday = (8 - reset.getUTCDay()) % 7 || 7;
  reset.setUTCDate(reset.getUTCDate() + daysUntilMonday);
  reset.setUTCHours(0, 0, 0, 0);
  const remaining = Math.max(0, reset.getTime() - now);
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const timeLeft = days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;

  return (
    <p
      className="leaderboard-period-note"
      role="timer"
      aria-label={`Weekly leaderboard resets in ${timeLeft}`}
    >
      Weekly leaderboard resets in <strong>{timeLeft}</strong> · every Monday at 00:00 UTC.
    </p>
  );
}

function SubscriptionPage({
  status,
  loading,
  error,
  paymentReference,
  checkoutBusy,
  attempts,
  papers,
  courses,
  onRefresh,
  onChoosePlan,
}: {
  status: RimblyBillingStatus | null;
  loading: boolean;
  error: string | null;
  paymentReference: string | null;
  checkoutBusy: boolean;
  attempts: QuizAttempt[];
  papers: Paper[];
  courses: Course[];
  onRefresh: () => void;
  onChoosePlan: (planId: RimblyPlanId) => void;
}) {
  const paymentMatches = Boolean(
    paymentReference && status?.latest_payment_ref === paymentReference,
  );
  const paymentPaid = paymentMatches && status?.latest_payment_status === "paid";
  const paymentFailed = paymentMatches && status?.latest_payment_status === "failed";

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentAttempts = attempts
    .filter((attempt) => new Date(attempt.created_at).getTime() >= cutoff)
    .sort((first, second) => first.created_at.localeCompare(second.created_at));
  const completedQuestions = recentAttempts.reduce(
    (total, attempt) => total + attempt.total_questions,
    0,
  );
  const correctAnswers = recentAttempts.reduce(
    (total, attempt) => total + attempt.correct_count,
    0,
  );
  const averageScore = recentAttempts.length
    ? Math.round(
        recentAttempts.reduce((total, attempt) => total + attempt.score_percent, 0) /
          recentAttempts.length,
      )
    : 0;
  const paperById = new Map(papers.map((paper) => [paper.id, paper]));
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const courseResults = new Map<string, { label: string; correct: number; total: number }>();
  for (const attempt of recentAttempts) {
    const paper = attempt.paper_id ? paperById.get(attempt.paper_id) : undefined;
    const course = paper ? courseById.get(paper.course_id) : undefined;
    const key = course?.id ?? attempt.quiz_title ?? attempt.id;
    const result = courseResults.get(key) ?? {
      label: course ? `${course.code} · ${course.title}` : (attempt.quiz_title ?? "Practice quiz"),
      correct: 0,
      total: 0,
    };
    result.correct += attempt.correct_count;
    result.total += attempt.total_questions;
    courseResults.set(key, result);
  }
  const courseBreakdown = [...courseResults.values()]
    .map((result) => ({
      ...result,
      accuracy: result.total ? Math.round((result.correct / result.total) * 100) : 0,
    }))
    .sort((first, second) => second.accuracy - first.accuracy)
    .slice(0, 5);

  return (
    <>
      <div className="page-head compact">
        <span className="eyebrow">Learn more, keep your momentum</span>
        <h1>Rimbly Pro</h1>
        <p>
          More practice, deeper insight, and a little extra campus flair. Your past-question library
          stays free.
        </p>
      </div>
      {paymentReference && (
        <div className={`billing-payment-message ${paymentFailed ? "failed" : ""}`} role="status">
          <div>
            <strong>
              {paymentPaid
                ? "Your Rimbly Pro payment is confirmed."
                : paymentFailed
                  ? "That payment was not completed."
                  : "We’re confirming your payment."}
            </strong>
            <p>
              {paymentPaid
                ? "Your plan is active. Welcome to Pro."
                : paymentFailed
                  ? "You have not been charged for an unsuccessful payment. You can try again."
                  : "Access starts only after SquadCo verifies the payment. This can take a moment."}
            </p>
          </div>
          {!paymentPaid && (
            <Button variant="secondary" onClick={onRefresh}>
              Check status
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="app-feedback" role="alert">
          Billing request failed: {error}
        </p>
      )}
      <section className="billing-current-plan">
        <div>
          <span className="eyebrow">Your plan</span>
          <h2>
            {loading ? "Checking your plan…" : status?.is_pro ? "Rimbly Pro" : "Free Forever"}
          </h2>
          <p>
            {status?.is_pro && status.expires_at
              ? `Active until ${new Date(status.expires_at).toLocaleDateString(undefined, {
                  dateStyle: "long",
                })}. Plans do not auto-renew.`
              : "Core study tools and the past-question library stay free."}
          </p>
        </div>
        {status?.is_pro && <span className="badge badge-purple pro-flair">PRO SCHOLAR</span>}
      </section>

      <section className="billing-usage">
        <div className="section-title">
          <div>
            <span>Today · UTC</span>
            <h2>Your free-plan usage</h2>
          </div>
          {status && <button onClick={onRefresh}>Refresh</button>}
        </div>
        <div className="billing-usage-grid">
          <UsageMeter
            label="Quiz submissions"
            used={status?.quizzes_used_today ?? 0}
            limit={status?.free_quiz_limit ?? 5}
            unlimited={Boolean(status?.is_pro)}
          />
          <UsageMeter
            label="Battle invites sent"
            used={status?.battle_invites_used_today ?? 0}
            limit={status?.free_battle_limit ?? 3}
            unlimited={Boolean(status?.is_pro)}
          />
        </div>
      </section>

      <section className="billing-plans">
        <div className="section-title">
          <div>
            <span>Choose your term</span>
            <h2>Student-friendly pricing</h2>
          </div>
        </div>
        <div className="billing-plan-grid">
          {rimblyProPlans.map((plan) => (
            <article
              className={`billing-plan-card ${plan.id === "semester" ? "featured" : ""}`}
              key={plan.id}
            >
              {plan.id === "semester" && <span className="badge badge-purple">Best value</span>}
              <h3>{plan.name}</h3>
              <strong className="billing-price">₦{plan.priceNaira.toLocaleString("en-NG")}</strong>
              <small>for {plan.duration}</small>
              <Button disabled={checkoutBusy || loading} onClick={() => onChoosePlan(plan.id)}>
                {checkoutBusy
                  ? "Opening checkout…"
                  : status?.is_pro
                    ? "Add time"
                    : "Get Rimbly Pro"}
              </Button>
            </article>
          ))}
        </div>
        <p className="billing-disclaimer">
          One-time payment per term. No automatic renewals. Checkout is hosted by SquadCo.
        </p>
      </section>

      <section className="billing-comparison" aria-label="Free and Pro plan comparison">
        <article>
          <span className="eyebrow">Free Forever</span>
          <h2>Strong basics, always free</h2>
          <ul>
            <li>Past-question library</li>
            <li>5 quiz submissions per day</li>
            <li>3 one-on-one battle invites per day</li>
            <li>University leaderboard and standard titles</li>
            <li>Basic practice stats</li>
          </ul>
        </article>
        <article className="billing-comparison-pro">
          <span className="eyebrow">Rimbly Pro</span>
          <h2>More room to improve</h2>
          <ul>
            <li>Unlimited quiz submissions and battle invites</li>
            <li>Detailed 30-day performance analytics</li>
            <li>Exclusive Pro Scholar profile and leaderboard flair</li>
            <li>Priority matchmaking when automatic matchmaking is available</li>
          </ul>
        </article>
      </section>

      {status?.is_pro && (
        <section className="pro-analytics">
          <div className="section-title">
            <div>
              <span>Rimbly Pro</span>
              <h2>Your 30-day performance</h2>
            </div>
          </div>
          {recentAttempts.length ? (
            <>
              <div className="pro-analytics-stats">
                <article>
                  <strong>{recentAttempts.length}</strong>
                  <small>Quiz submissions</small>
                </article>
                <article>
                  <strong>{averageScore}%</strong>
                  <small>Average score</small>
                </article>
                <article>
                  <strong>
                    {completedQuestions
                      ? Math.round((correctAnswers / completedQuestions) * 100)
                      : 0}
                    %
                  </strong>
                  <small>Question accuracy</small>
                </article>
              </div>
              <div
                className="pro-score-trend"
                role="img"
                aria-label="Scores for your recent quizzes"
              >
                {recentAttempts.slice(-12).map((attempt) => (
                  <span
                    key={attempt.id}
                    title={`${attempt.quiz_title ?? "Quiz"}: ${attempt.score_percent}%`}
                    style={{ height: `${Math.max(8, attempt.score_percent)}%` }}
                  />
                ))}
              </div>
              {courseBreakdown.length > 0 && (
                <div className="pro-course-breakdown">
                  <h3>Accuracy by course</h3>
                  {courseBreakdown.map((result) => (
                    <div className="pro-course-row" key={result.label}>
                      <span>{result.label}</span>
                      <strong>{result.accuracy}%</strong>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="field-note">
              Complete a quiz to start your 30-day score, accuracy, and course insights.
            </p>
          )}
        </section>
      )}
    </>
  );
}

function UsageMeter({
  label,
  used,
  limit,
  unlimited,
}: {
  label: string;
  used: number;
  limit: number;
  unlimited: boolean;
}) {
  const progress = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <article className="billing-usage-meter">
      <div>
        <strong>{label}</strong>
        <span>{unlimited ? "Unlimited on Pro" : `${used} of ${limit} used`}</span>
      </div>
      <div className="billing-meter-track" aria-hidden="true">
        <span style={{ width: `${unlimited ? 100 : progress}%` }} />
      </div>
    </article>
  );
}

const maintenanceStatusCacheKey = "rimbly-maintenance-status";

function readCachedMaintenanceStatus(): MaintenanceStatus | null {
  try {
    const cached = window.localStorage.getItem(maintenanceStatusCacheKey);
    if (!cached) return null;

    const value: unknown = JSON.parse(cached);
    if (
      typeof value !== "object" ||
      value === null ||
      !("active" in value) ||
      typeof value.active !== "boolean" ||
      !("title" in value) ||
      typeof value.title !== "string" ||
      !("message" in value) ||
      typeof value.message !== "string" ||
      !("ends_at" in value) ||
      (value.ends_at !== null && typeof value.ends_at !== "string") ||
      !("updated_at" in value) ||
      typeof value.updated_at !== "string"
    ) {
      return null;
    }

    const status = value as MaintenanceStatus;
    const endTime = status.ends_at ? Date.parse(status.ends_at) : Number.NaN;
    return {
      ...status,
      active: status.active && Number.isFinite(endTime) && endTime > Date.now(),
    };
  } catch {
    return null;
  }
}

function App() {
  const [route, setRoute] = useState<Route>(routeFromLocation);
  const [pendingBattleId, setPendingBattleId] = useState(pendingBattleInviteFromLocation);
  const [pendingReferralCode, setPendingReferralCode] = useState(pendingReferralCodeFromLocation);
  const [verificationEmail, setVerificationEmail] = useState(
    () => window.sessionStorage.getItem("rimbly-verification-email") ?? "",
  );
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [maintenanceStatus, setMaintenanceStatusState] = useState<MaintenanceStatus | null>(
    readCachedMaintenanceStatus,
  );
  const [maintenanceStatusLoaded, setMaintenanceStatusLoaded] = useState(
    () => readCachedMaintenanceStatus() !== null,
  );
  const [maintenanceStatusError, setMaintenanceStatusError] = useState<string | null>(null);
  const [maintenanceStatusRetry, setMaintenanceStatusRetry] = useState(0);
  const hasUsableMaintenanceStatus = useRef(maintenanceStatus !== null);
  const [loading, setLoading] = useState(false);
  const [adminAccess, setAdminAccess] = useState<AdminAccess | null>(null);
  const [adminAccessLoaded, setAdminAccessLoaded] = useState(false);
  const [adminAccessError, setAdminAccessError] = useState<string | null>(null);
  const [ambassadorDashboard, setAmbassadorDashboard] = useState<AmbassadorDashboard | null>(null);
  const [ambassadorLoading, setAmbassadorLoading] = useState(false);
  const [ambassadorError, setAmbassadorError] = useState<string | null>(null);
  const [ambassadorBusy, setAmbassadorBusy] = useState(false);
  const [ambassadorRetry, setAmbassadorRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(supabaseConfigurationError);
  const [notice, setNotice] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gameProgress, setGameProgress] = useState<GameProgress | null>(null);
  const [gameProgressLoading, setGameProgressLoading] = useState(true);
  const [gameProgressError, setGameProgressError] = useState<string | null>(null);
  const [billingStatus, setBillingStatus] = useState<RimblyBillingStatus | null>(null);
  const [billingStatusLoading, setBillingStatusLoading] = useState(true);
  const [billingStatusError, setBillingStatusError] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [universities, setUniversities] = useState<University[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const quizSubmissionKeyRef = useRef<string | null>(null);
  const contributionSubmissionKeyRef = useRef<string | null>(null);
  const quizSubmissionLockRef = useRef(false);
  const contributionSubmissionLockRef = useRef(false);
  const [savedCourseIds, setSavedCourseIds] = useState<string[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [lastAttempt, setLastAttempt] = useState<QuizAttempt | null>(null);
  const [lastAttemptReview, setLastAttemptReview] = useState<QuizAttemptReviewItem[]>([]);
  const [lastAttemptReviewLoading, setLastAttemptReviewLoading] = useState(false);
  const [lastAttemptReviewError, setLastAttemptReviewError] = useState<string | null>(null);
  const [paperQuizAvailability, setPaperQuizAvailability] = useState<PaperQuizAvailability | null>(
    null,
  );
  const [publishedQuizSets, setPublishedQuizSets] = useState<QuizSet[]>([]);
  const [publishedQuizSetsLoading, setPublishedQuizSetsLoading] = useState(true);
  const [activeQuizSetId, setActiveQuizSetId] = useState<string | null>(null);
  const [sourceToRead, setSourceToRead] = useState<{ path: string; title: string } | null>(null);
  const [leaderboardScope, setLeaderboardScope] = useState<"university" | "all">("university");
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<"weekly" | "all-time">("weekly");
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [campusLeaders, setCampusLeaders] = useState<Leader[]>([]);
  const [campusLeadersLoading, setCampusLeadersLoading] = useState(false);
  const [campusLeadersError, setCampusLeadersError] = useState<string | null>(null);
  const [dailyChallengeLeaders, setDailyChallengeLeaders] = useState<DailyChallengeLeader[]>([]);
  const [dailyChallengeLeadersLoading, setDailyChallengeLeadersLoading] = useState(false);
  const [dailyChallengeLeadersError, setDailyChallengeLeadersError] = useState<string | null>(null);
  const [utcDate, setUtcDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [homeGuideState, setHomeGuideState] = useState<{
    userId: string | null;
    dismissed: boolean;
  }>({ userId: null, dismissed: true });

  const user = session?.user ?? null;
  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  const selectedPaper = papers.find((paper) => paper.id === selectedPaperId) ?? null;
  const prioritizedCourses = useMemo(
    () => sortCoursesForProfile(courses, profile, papers, publishedQuizSets),
    [courses, papers, profile, publishedQuizSets],
  );
  const prioritizedQuizSets = useMemo(
    () => sortQuizSetsForProfile(publishedQuizSets, profile),
    [publishedQuizSets, profile],
  );
  const dailyChallenge = useMemo(() => {
    const candidates = publishedQuizSets
      .filter((quiz) => quiz.question_count >= 10)
      .sort((first, second) => first.id.localeCompare(second.id));
    if (!candidates.length) return null;
    const dayIndex = Math.floor(Date.parse(`${utcDate}T00:00:00Z`) / 86_400_000);
    return candidates[dayIndex % candidates.length];
  }, [publishedQuizSets, utcDate]);

  const navigate = (next: Route) => {
    setError(null);
    setNotice(null);
    window.history.pushState({ route: next }, "", routeUrl(next));
    setRoute(next);
  };

  const startAmbassadorFlow = () => {
    if (user) {
      if (!profile) window.sessionStorage.setItem(postSignupRouteStorageKey, "ambassador");
      navigate("ambassador");
      return;
    }
    window.sessionStorage.setItem(postSignupRouteStorageKey, "ambassador");
    navigate("signup");
  };

  const startAmbassadorSignIn = () => {
    window.sessionStorage.setItem(postSignupRouteStorageKey, "ambassador");
    navigate("login");
  };

  const dismissHomeGuide = () => {
    if (!user) return;
    window.localStorage.setItem(`rimbly-home-guide-dismissed:${user.id}`, "true");
    setHomeGuideState({ userId: user.id, dismissed: true });
  };

  const clearPendingBattleInvite = () => {
    window.sessionStorage.removeItem(pendingBattleInviteStorageKey);
    setPendingBattleId(null);
  };

  const startProCheckout = async (planId: RimblyPlanId) => {
    if (!session?.access_token) {
      setBillingStatusError("Sign in again before starting checkout.");
      return;
    }
    setCheckoutBusy(true);
    setBillingStatusError(null);
    try {
      const response = await fetch("/api/squadco/checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ planId }),
      });
      const responseText = await response.text();
      let result: { checkoutUrl?: unknown; error?: unknown } | null = null;
      try {
        result = JSON.parse(responseText) as { checkoutUrl?: unknown; error?: unknown };
      } catch {
        throw new Error(
          response.ok
            ? "Checkout returned an unreadable response. Please try again."
            : `Checkout failed before returning a response (HTTP ${response.status}). Please try again.`,
        );
      }
      if (!result || typeof result !== "object") {
        throw new Error("Checkout returned an invalid response. Please try again.");
      }
      if (!response.ok) {
        throw new Error(
          typeof result.error === "string" ? result.error : "Could not start SquadCo checkout.",
        );
      }
      if (typeof result.checkoutUrl !== "string") {
        throw new Error("SquadCo returned an invalid checkout link.");
      }
      window.location.assign(result.checkoutUrl);
    } catch (checkoutError) {
      setBillingStatusError(
        checkoutError instanceof Error ? checkoutError.message : "Could not start checkout.",
      );
    } finally {
      setCheckoutBusy(false);
    }
  };

  const refreshRimblyBillingStatus = async () => {
    setBillingStatusLoading(true);
    setBillingStatusError(null);
    try {
      setBillingStatus(await getMyRimblyBillingStatus());
    } catch (statusError) {
      setBillingStatusError(
        statusError instanceof Error ? statusError.message : "Could not load subscription details.",
      );
    } finally {
      setBillingStatusLoading(false);
    }
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
        if (event === "SIGNED_OUT") navigate("welcome");
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
      if (!hasUsableMaintenanceStatus.current) {
        setMaintenanceStatusError(
          supabaseConfigurationError ?? "The maintenance status service is unavailable.",
        );
        setMaintenanceStatusLoaded(true);
      }
      return;
    }

    let active = true;
    const refreshStatus = async () => {
      try {
        const status = await getMaintenanceStatus();
        if (!active) return;
        setMaintenanceStatusState(status);
        hasUsableMaintenanceStatus.current = true;
        try {
          window.localStorage.setItem(maintenanceStatusCacheKey, JSON.stringify(status));
        } catch (cacheError) {
          console.warn("Could not cache the latest maintenance status.", cacheError);
        }
        setMaintenanceStatusError(null);
      } catch (statusError) {
        if (!active) return;
        if (!hasUsableMaintenanceStatus.current) {
          setMaintenanceStatusError(
            statusError instanceof Error
              ? statusError.message
              : "Could not check whether the website is under maintenance.",
          );
        }
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
  }, [maintenanceStatusRetry]);

  useEffect(() => {
    if (!user) {
      setHomeGuideState({ userId: null, dismissed: true });
      return;
    }
    setHomeGuideState({
      userId: user.id,
      dismissed: window.localStorage.getItem(`rimbly-home-guide-dismissed:${user.id}`) === "true",
    });
  }, [user?.id]);

  useEffect(() => {
    if (user && route === "ambassador" && !profile) {
      window.sessionStorage.setItem(postSignupRouteStorageKey, "ambassador");
    }
  }, [profile, route, user?.id]);

  useEffect(() => {
    if (!authReady) return;
    const publicRoutes: Route[] = [
      "welcome",
      "explore",
      "signup",
      "login",
      "forgot-password",
      "verify-email",
      "reset-password",
      "ambassador",
    ];
    if (
      user &&
      publicRoutes.includes(route) &&
      route !== "reset-password" &&
      route !== "ambassador"
    )
      navigate(
        pendingBattleId ? (profile ? "battle" : "onboarding") : profile ? "home" : "onboarding",
      );
    else if (!user && !publicRoutes.includes(route)) navigate("welcome");
  }, [authReady, user, profile, route, pendingBattleId]);

  useEffect(() => {
    if (!user || route !== "battle" || !pendingBattleId) return;
    window.sessionStorage.removeItem(pendingBattleInviteStorageKey);
    setPendingBattleId(null);
  }, [pendingBattleId, route, user?.id]);

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
            navigate(
              nextProfile?.university && nextProfile.level
                ? pendingBattleId
                  ? "battle"
                  : "home"
                : "onboarding",
            );
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
    if (!user) return;
    const interval = window.setInterval(() => {
      const currentDate = new Date().toISOString().slice(0, 10);
      setUtcDate((previousDate) => {
        if (previousDate === currentDate) return previousDate;
        void refreshRimblyBillingStatus();
        return currentDate;
      });
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      setGameProgress(null);
      setGameProgressError(null);
      setGameProgressLoading(false);
      return;
    }
    let active = true;
    setGameProgressLoading(true);
    setGameProgressError(null);
    void getGameProgress()
      .then((result) => {
        if (active) setGameProgress(result);
      })
      .catch((progressError: unknown) => {
        if (active) {
          setGameProgressError(
            progressError instanceof Error
              ? progressError.message
              : "Could not load your game progress.",
          );
        }
      })
      .finally(() => {
        if (active) setGameProgressLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      setBillingStatus(null);
      setBillingStatusError(null);
      setBillingStatusLoading(false);
      return;
    }

    let active = true;
    let pollCount = 0;
    const paymentReference =
      route === "subscription" ? new URLSearchParams(window.location.search).get("payment") : null;
    setBillingStatusLoading(true);
    setBillingStatusError(null);

    const refresh = async () => {
      try {
        const status = await getMyRimblyBillingStatus();
        if (!active) return;
        setBillingStatus(status);
        setBillingStatusError(null);
        if (
          paymentReference &&
          status.latest_payment_ref === paymentReference &&
          status.latest_payment_status !== "pending"
        ) {
          window.clearInterval(pollInterval);
        }
      } catch (statusError) {
        if (active) {
          setBillingStatusError(
            statusError instanceof Error
              ? statusError.message
              : "Could not load subscription details.",
          );
        }
      } finally {
        if (active) setBillingStatusLoading(false);
      }
    };

    void refresh();
    const pollInterval =
      paymentReference && route === "subscription"
        ? window.setInterval(() => {
            pollCount += 1;
            if (pollCount >= 20) {
              window.clearInterval(pollInterval);
              return;
            }
            void refresh();
          }, 3000)
        : undefined;

    return () => {
      active = false;
      if (pollInterval) window.clearInterval(pollInterval);
    };
  }, [route, user?.id]);

  useEffect(() => {
    if (!user || !["home", "practice", "course", "quiz-setup", "paper", "profile"].includes(route))
      return;
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
    if (!user || route !== "home" || !profile?.university) {
      setCampusLeaders([]);
      setCampusLeadersError(null);
      return;
    }
    let active = true;
    setCampusLeadersLoading(true);
    setCampusLeadersError(null);
    void getLeaderboard(profile.university, "weekly")
      .then((result) => {
        if (active) setCampusLeaders(result);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setCampusLeadersError(
            loadError instanceof Error ? loadError.message : "Could not load campus activity.",
          );
        }
      })
      .finally(() => {
        if (active) setCampusLeadersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [profile?.university, route, user?.id]);

  useEffect(() => {
    if (!user || route !== "home" || !dailyChallenge) {
      setDailyChallengeLeaders([]);
      setDailyChallengeLeadersError(null);
      setDailyChallengeLeadersLoading(false);
      return;
    }
    let active = true;
    setDailyChallengeLeadersLoading(true);
    setDailyChallengeLeadersError(null);
    void getDailyChallengeLeaderboard(dailyChallenge.id)
      .then((result) => {
        if (active) setDailyChallengeLeaders(result);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setDailyChallengeLeadersError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load today’s challenge leaderboard.",
          );
        }
      })
      .finally(() => {
        if (active) setDailyChallengeLeadersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempts.length, dailyChallenge?.id, route, user?.id, utcDate]);

  useEffect(() => {
    if (!user || !profile || route !== "leaderboard") return;
    let active = true;
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    void getLeaderboard(
      leaderboardScope === "university" ? profile.university : null,
      leaderboardPeriod,
    )
      .then((result) => {
        if (active) setLeaders(result);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setLeaderboardError(
            loadError instanceof Error ? loadError.message : "Could not load rankings.",
          );
        }
      })
      .finally(() => {
        if (active) setLeaderboardLoading(false);
      });
    return () => {
      active = false;
    };
  }, [leaderboardPeriod, leaderboardScope, profile?.university, route, user?.id]);

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

  useEffect(() => {
    if (!user || route !== "ambassador") return;
    let active = true;
    setAmbassadorLoading(true);
    setAmbassadorError(null);
    void getAmbassadorDashboard()
      .then((dashboard) => {
        if (active) setAmbassadorDashboard(dashboard);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setAmbassadorError(
            loadError instanceof Error ? loadError.message : "Could not load ambassador details.",
          );
        }
      })
      .finally(() => {
        if (active) setAmbassadorLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ambassadorRetry, route, user?.id]);

  const refreshActivity = async () => {
    if (!user) return;
    const [nextAttempts, nextLeaders, nextNotifications, nextContributions, nextGameProgress] =
      await Promise.all([
        getQuizAttempts(user.id),
        getLeaderboard(
          leaderboardScope === "university" ? profile?.university : null,
          leaderboardPeriod,
        ),
        getNotifications(user.id),
        getContributions(user.id),
        getGameProgress(),
      ]);
    setAttempts(nextAttempts);
    setLastAttempt(nextAttempts[0] ?? null);
    setLeaders(nextLeaders);
    setNotifications(nextNotifications);
    setContributions(nextContributions);
    setGameProgress(nextGameProgress);
    setGameProgressError(null);
    setGameProgressLoading(false);
    setLeaderboardError(null);
    await refreshRimblyBillingStatus();
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
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: routeUrl("onboarding"),
            data: pendingReferralCode ? { rimbly_referral_code: pendingReferralCode } : undefined,
          },
        });
        if (authError) throw authError;
        window.sessionStorage.removeItem(pendingReferralCodeStorageKey);
        setPendingReferralCode(null);
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
        const postSignupRoute =
          window.sessionStorage.getItem(postSignupRouteStorageKey) === "ambassador"
            ? "ambassador"
            : null;
        window.sessionStorage.removeItem(postSignupRouteStorageKey);
        navigate(postSignupRoute ?? (pendingBattleId ? "battle" : "home"));
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

  const handleResetPassword = async (email: string) => {
    if (!supabase || !email) return;
    setBusy(true);
    setError(null);
    setNotice(null);
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
      const postSignupRoute =
        window.sessionStorage.getItem(postSignupRouteStorageKey) === "ambassador"
          ? "ambassador"
          : null;
      window.sessionStorage.removeItem(postSignupRouteStorageKey);
      navigate(
        route === "onboarding"
          ? (postSignupRoute ?? (pendingBattleId ? "battle" : "home"))
          : "profile",
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const handleAgreeToAmbassadorTerms = async () => {
    if (!user) {
      startAmbassadorFlow();
      return;
    }
    setAmbassadorBusy(true);
    setAmbassadorError(null);
    try {
      setAmbassadorDashboard(await agreeToAmbassadorTerms());
    } catch (agreementError) {
      setAmbassadorError(
        getErrorMessage(agreementError, "Could not create your ambassador invite link."),
      );
    } finally {
      setAmbassadorBusy(false);
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
      quizSubmissionKeyRef.current = crypto.randomUUID();
      setActiveQuizSetId(quizId);
      setQuestions(nextQuestions);
      setAnswers({});
      setLastAttempt(null);
      setLastAttemptReview([]);
      setLastAttemptReviewError(null);
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
    if (!activeQuizSetId || !user || quizSubmissionLockRef.current) return;
    const answerIds = Object.keys(answers);
    const questionsById = new Map(questions.map((question) => [question.id, question]));
    const hasValidAnswers =
      questions.length === 10 &&
      answerIds.length === 10 &&
      answerIds.every((questionId) => {
        const question = questionsById.get(questionId);
        const answer = answers[questionId];
        return (
          !!question && Number.isInteger(answer) && answer >= 0 && answer < question.options.length
        );
      });
    if (!hasValidAnswers) {
      setError("Answer all 10 questions before submitting.");
      return;
    }

    quizSubmissionLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const duration = Math.max(0, Math.floor((Date.now() - quizStartedAt) / 1000));
      const submissionKey = (quizSubmissionKeyRef.current ??= crypto.randomUUID());
      const attempt = await submitQuizSet(activeQuizSetId, answers, duration, submissionKey);
      quizSubmissionKeyRef.current = null;
      const activeQuiz = publishedQuizSets.find((quiz) => quiz.id === activeQuizSetId);
      const previousAttempt = attempts.find(
        (item) =>
          item.quiz_id === activeQuizSetId ||
          (!!activeQuiz?.paper_id && item.paper_id === activeQuiz.paper_id),
      );
      setLastAttempt({
        ...attempt,
        points_earned: attempt.points_earned ?? attempt.correct_count * 10,
        previous_score_percent: previousAttempt?.score_percent,
      });
      setLastAttemptReview([]);
      setLastAttemptReviewLoading(true);
      setLastAttemptReviewError(null);
      navigate("results");
      try {
        const review = await getQuizAttemptReview(attempt.id);
        setLastAttemptReview(review);
        if (review.length) {
          void recordReviewedQuizActivation(attempt.id).catch((activationError: unknown) => {
            console.error("Could not record first reviewed-quiz activation.", activationError);
          });
        }
      } catch (reviewError) {
        setLastAttemptReviewError(
          reviewError instanceof Error
            ? reviewError.message
            : "Your score was saved, but the answer review could not load.",
        );
      } finally {
        setLastAttemptReviewLoading(false);
      }
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
      quizSubmissionLockRef.current = false;
      setBusy(false);
    }
  };

  const [quizStartedAt, setQuizStartedAt] = useState(Date.now());
  const startQuiz = async (quizId?: string) => {
    await handleStartQuiz(quizId);
  };

  const handleContribution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || contributionSubmissionLockRef.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const course = {
      university: String(data.get("university") ?? profile?.university ?? "").trim(),
      course_code: String(data.get("course_code") ?? "").trim(),
      course_title: String(data.get("course_title") ?? "").trim(),
      exam_year: Number(data.get("exam_year")),
      notes: String(data.get("notes") ?? "").trim(),
    };
    const currentYear = new Date().getFullYear();

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a PDF or image to upload.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("The file must be 20 MB or smaller.");
      return;
    }
    if (!file.name || file.name.length > 255 || /[\u0000-\u001f]/u.test(file.name)) {
      setError("Use a file name with 255 characters or fewer and no control characters.");
      return;
    }
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) {
      setError("Upload a PDF, JPG, or PNG file.");
      return;
    }
    if (
      !course.university ||
      course.university.length > 160 ||
      !course.course_code ||
      course.course_code.length > 40 ||
      !course.course_title ||
      course.course_title.length > 200 ||
      !Number.isInteger(course.exam_year) ||
      course.exam_year < 1990 ||
      course.exam_year > currentYear ||
      course.notes.length > 2000
    ) {
      setError("Check the university, course details, exam year, and notes before submitting.");
      return;
    }

    contributionSubmissionLockRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const submissionKey = (contributionSubmissionKeyRef.current ??= crypto.randomUUID());
      await createContribution(
        user.id,
        { name: profile?.full_name || user.user_metadata.full_name || "", email: user.email ?? "" },
        course,
        file,
        submissionKey,
      );
      contributionSubmissionKeyRef.current = null;
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
      contributionSubmissionLockRef.current = false;
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
    const maintenanceSetupMissing = maintenanceStatusError.includes(
      "Maintenance controls are not installed yet",
    );
    return (
      <div className="maintenance-error-page" role="alert">
        <span className="eyebrow">Website availability</span>
        <h1>
          {maintenanceSetupMissing ? "Maintenance check needs setup." : "Connection interrupted."}
        </h1>
        <p>{maintenanceStatusError}</p>
        {maintenanceSetupMissing ? (
          <>
            <p>Ask a Super Admin to apply the maintenance setup before continuing.</p>
            <Button onClick={() => void handleMaintenanceAdminSignIn()}>
              {user ? "Switch account" : "Super Admin sign in"}
            </Button>
          </>
        ) : (
          <>
            <p>We couldn’t verify the site status. Check your connection and try again.</p>
            <Button onClick={() => setMaintenanceStatusRetry((attempt) => attempt + 1)}>
              Try again
            </Button>
          </>
        )}
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

  if (route === "forgot-password") {
    return (
      <ForgotPasswordPage
        busy={busy}
        error={pageError}
        notice={notice}
        onSubmit={(email) => void handleResetPassword(email)}
        onNavigate={navigate}
        onClearError={() => setError(null)}
        configured={Boolean(supabase)}
      />
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

  if (route === "explore") {
    return <GuestExplorePage configured={Boolean(supabase)} onNavigate={navigate} />;
  }

  if (route === "ambassador" && !user) {
    return (
      <AmbassadorPage
        signedIn={false}
        dashboard={null}
        loading={false}
        error={null}
        busy={false}
        onAgree={() => startAmbassadorFlow()}
        onRetry={() => {}}
        onSignIn={startAmbassadorSignIn}
        onNavigate={navigate}
      />
    );
  }

  if (route === "welcome" || route === "signup" || route === "login") {
    if (route === "welcome") {
      return (
        <div className="auth-shell">
          <section className="auth-art">
            <Logo onClick={() => navigate("welcome")} />
            <div className="welcome-emblem" aria-hidden="true">
              <video
                className="welcome-cheetah"
                src="/rimbly-cheetah-hero.mp4"
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
              />
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
              <ul className="welcome-trust-list" aria-label="How Rimbly supports your study">
                <li>Human-reviewed questions</li>
                <li>University-focused courses</li>
                <li>Scores with answer review</li>
              </ul>
            </div>
          </section>
          <section className="auth-panel">
            <h2>
              Your academic edge
              <br />
              starts here.
            </h2>
            <p>
              Try two exam-style questions and review your answers, then create an account to save
              progress and practise reviewed quizzes.
            </p>
            <QuizPreview onCreateAccount={() => navigate("signup")} />
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
            <Button variant="secondary" disabled={!supabase} onClick={() => navigate("login")}>
              I already have an account
            </Button>
            <button
              className="guest-explore-link"
              type="button"
              disabled={!supabase}
              onClick={() => navigate("signup")}
            >
              Create a free account →
            </button>
            <button
              className="guest-explore-link"
              type="button"
              onClick={() => navigate("explore")}
            >
              Explore courses without an account →
            </button>
            <button
              className="guest-explore-link"
              type="button"
              onClick={() => navigate("ambassador")}
            >
              Ambassador program →
            </button>
            <small>Reviewed quizzes · University-focused courses · Score and answer review</small>
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
  const matchingCourseQuizzes = selectedCourse
    ? publishedQuizSets.filter((quiz) => matchingPapers.some((paper) => paper.id === quiz.paper_id))
    : [];
  const activeQuiz = publishedQuizSets.find((quiz) => quiz.id === activeQuizSetId);
  const activeQuizPaper = papers.find((paper) => paper.id === activeQuiz?.paper_id);
  const activeQuizUniversity =
    activeQuiz?.university ??
    activeQuiz?.audience_university ??
    courses.find((course) => course.id === activeQuizPaper?.course_id)?.university ??
    "University context not provided";
  const showHomeGuide =
    route === "home" &&
    homeGuideState.userId === user.id &&
    !homeGuideState.dismissed &&
    !publishedQuizSetsLoading;
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
          {showHomeGuide && (
            <FirstSessionGuide
              quiz={prioritizedQuizSets[0] ?? null}
              onStart={() => {
                dismissHomeGuide();
                void startQuiz(prioritizedQuizSets[0]?.id);
              }}
              onBrowse={() => navigate("quiz-setup")}
              onBattle={() => {
                dismissHomeGuide();
                navigate("battle");
              }}
              onDismiss={dismissHomeGuide}
            />
          )}
          <DailyGoalCard
            status={billingStatus}
            progress={gameProgress}
            loading={billingStatusLoading}
            error={billingStatusError}
            hasQuiz={Boolean(dailyChallenge)}
            showAction={!showHomeGuide}
            onQuiz={() =>
              dailyChallenge ? void startQuiz(dailyChallenge.id) : navigate("quiz-setup")
            }
            onPlans={() => navigate("subscription")}
          />
          {ambassadorDashboard?.status !== "removed" && (
            <section className="ambassador-home-prompt">
              <div>
                <span className="eyebrow">
                  {ambassadorDashboard ? "Grow with Rimbly" : "Student ambassador program"}
                </span>
                <strong>
                  {ambassadorDashboard
                    ? "Your invite link is ready."
                    : "Invite students. Earn ₦250 for each first quiz."}
                </strong>
              </div>
              <Button variant="secondary" onClick={() => navigate("ambassador")}>
                {ambassadorDashboard ? "View ambassador dashboard" : "Become an ambassador"}
              </Button>
            </section>
          )}
          <details className="home-progress-details home-community-details">
            <summary>
              <span>
                <small>Campus activity</small>
                <strong>Daily challenge and university rankings</strong>
              </span>
              <span className="home-progress-summary">Explore</span>
            </summary>
            <div className="home-community-details-content">
              <DailyChallengeCard
                quiz={dailyChallenge}
                leaders={dailyChallengeLeaders}
                leadersLoading={dailyChallengeLeadersLoading}
                leadersError={dailyChallengeLeadersError}
                userId={user.id}
                onStart={() => void startQuiz(dailyChallenge?.id)}
              />
              <CampusActivityCard
                university={profile.university}
                leaders={campusLeaders}
                loading={campusLeadersLoading}
                error={campusLeadersError}
                userId={user.id}
              />
            </div>
          </details>
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
                    hasReviewedQuiz={courseHasReviewedQuiz(course, papers, publishedQuizSets)}
                    onClick={() => {
                      setSelectedCourseId(course.id);
                      navigate("course");
                    }}
                  />
                ))}
              </div>
            ) : loading ? (
              <LoadingCards label="Loading your university courses" count={3} />
            ) : (
              <EmptyState
                title="No courses yet"
                text="Courses will appear here as they are added to the study library."
                action="Open practice library"
                onAction={() => navigate("practice")}
              />
            )}
          </section>
          <details className="home-progress-details">
            <summary>
              <span>
                <small>Your account</small>
                <strong>Progress and quiz history</strong>
              </span>
              <span className="home-progress-summary">
                {attempts.length
                  ? `${attempts.length} ${attempts.length === 1 ? "quiz" : "quizzes"}`
                  : "Your first score is one quiz away"}
              </span>
            </summary>
            <section>
              <div className="section-title">
                <div>
                  <span>Your account</span>
                  <h2>Practice activity</h2>
                </div>
                <button onClick={() => navigate("quiz-history")}>Quiz history ›</button>
              </div>
              {attempts.length || gameProgress?.battle_wins ? (
                <div className="stats-grid">
                  {attempts.length > 0 && (
                    <>
                      <Stat icon="✓" value={String(attempts.length)} label="Saved quizzes" />
                      <Stat
                        icon="◎"
                        value={`${Math.round(attempts.reduce((sum, item) => sum + item.score_percent, 0) / attempts.length)}%`}
                        label="Average score"
                      />
                    </>
                  )}
                  {gameProgress?.battle_wins ? (
                    <>
                      <Stat
                        icon="⚔"
                        value={`${gameProgress.current_win_streak} · best ${gameProgress.best_win_streak}`}
                        label="Battle win streak"
                        tone="hot"
                      />
                      <Stat
                        icon="🔥"
                        value={`${gameProgress.current_daily_streak} days`}
                        label="Daily streak"
                        tone="hot"
                      />
                    </>
                  ) : null}
                </div>
              ) : null}
              {gameProgressError && (
                <p className="field-note" role="alert">
                  Daily streak unavailable: {gameProgressError}
                </p>
              )}
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
                  title="Your first score is one quiz away"
                  text="Finish a reviewed quiz to see your score, review answers and start building your progress."
                  action="Start a reviewed quiz"
                  onAction={() =>
                    dailyChallenge ? void startQuiz(dailyChallenge.id) : navigate("quiz-setup")
                  }
                />
              )}
            </section>
          </details>
        </>
      );
      break;
    case "practice":
      title = "Practice";
      content = (
        <PracticePage
          courses={prioritizedCourses}
          papers={papers}
          quizzes={publishedQuizSets}
          loading={loading || publishedQuizSetsLoading}
          university={profile.university}
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
              {[
                selectedCourse.title,
                selectedCourse.department ? `Department: ${selectedCourse.department}` : null,
                selectedCourse.level ? `Level: ${selectedCourse.level}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="course-actions">
            <Button
              onClick={() =>
                matchingCourseQuizzes.length
                  ? void startQuiz(matchingCourseQuizzes[0].id)
                  : navigate("quiz-setup")
              }
            >
              {matchingCourseQuizzes.length ? "Start a reviewed quiz" : "Find a reviewed quiz"}
            </Button>
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
                    course={selectedCourse}
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
        <QuizSetupPage
          quizzes={prioritizedQuizSets}
          courses={courses}
          loading={publishedQuizSetsLoading}
          busy={busy}
          onTake={(quizId) => void startQuiz(quizId)}
          onReadSource={(path, title) => setSourceToRead({ path, title })}
          onRefresh={() => void refreshPublishedQuizSets(true)}
          onBrowseCourses={() => navigate("practice")}
        />
      );
      break;
    case "quiz":
      title = "Quiz";
      content = questions.length ? (
        <QuizPage
          questions={questions}
          quizTitle={activeQuiz?.title ?? "Reviewed quiz"}
          university={activeQuizUniversity}
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
          review={lastAttemptReview}
          reviewLoading={lastAttemptReviewLoading}
          reviewError={lastAttemptReviewError}
          onRetry={() => void handleStartQuiz(lastAttempt.quiz_id ?? activeQuizSetId ?? undefined)}
          onBrowse={() => navigate("quiz-setup")}
          onHistory={() => navigate("quiz-history")}
          onAmbassador={startAmbassadorFlow}
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
              title="Your first reviewed quiz starts your history"
              text="Complete a quiz to save your score and answer review here."
              action="Browse reviewed quizzes"
              onAction={() => navigate("quiz-setup")}
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
          onActivityRefresh={refreshActivity}
          onBillingRefresh={refreshRimblyBillingStatus}
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
              Earn 10 points per correct answer, plus 25 for a battle win or 8 for a draw. Build
              consecutive wins to climb the title ladder.
            </p>
          </div>
          <div className="segment" aria-label="Leaderboard scope">
            <button
              className={leaderboardScope === "university" ? "active" : ""}
              aria-pressed={leaderboardScope === "university"}
              onClick={() => setLeaderboardScope("university")}
            >
              My university
            </button>
            <button
              className={leaderboardScope === "all" ? "active" : ""}
              aria-pressed={leaderboardScope === "all"}
              onClick={() => setLeaderboardScope("all")}
            >
              All universities
            </button>
          </div>
          <div className="segment leaderboard-period" aria-label="Leaderboard period">
            <button
              className={leaderboardPeriod === "weekly" ? "active" : ""}
              aria-pressed={leaderboardPeriod === "weekly"}
              onClick={() => setLeaderboardPeriod("weekly")}
            >
              This week
            </button>
            <button
              className={leaderboardPeriod === "all-time" ? "active" : ""}
              aria-pressed={leaderboardPeriod === "all-time"}
              onClick={() => setLeaderboardPeriod("all-time")}
            >
              All time
            </button>
          </div>
          {leaderboardPeriod === "weekly" && <WeeklyResetNote />}
          <section className="title-preview">
            <div className="section-title">
              <div>
                <span>Earn your title</span>
                <h2>Battle badges</h2>
              </div>
            </div>
            <div className="title-preview-grid">
              <article>
                <span aria-hidden="true">✦</span>
                <strong>Rookie</strong>
                <small>Your starting title</small>
              </article>
              <article>
                <span aria-hidden="true">⚔</span>
                <strong>Contender</strong>
                <small>Win your first battle</small>
              </article>
              <article>
                <span aria-hidden="true">✧</span>
                <strong>Elite</strong>
                <small>Reach a 3-win streak</small>
              </article>
              <article>
                <span aria-hidden="true">◆</span>
                <strong>Grandmaster</strong>
                <small>Reach a 5-win streak</small>
              </article>
              <article>
                <span aria-hidden="true">★</span>
                <strong>Campus Legend</strong>
                <small>Reach a 10-win streak</small>
              </article>
            </div>
          </section>
          {leaderboardError && (
            <p className="app-feedback" role="alert">
              {leaderboardError}
            </p>
          )}
          {leaderboardLoading ? (
            <p className="field-note" role="status">
              Loading {leaderboardPeriod === "weekly" ? "this week’s" : "all-time"} rankings…
            </p>
          ) : leaders.length ? (
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
              text={
                leaderboardPeriod === "weekly"
                  ? "Play a quiz or battle this week to earn a place on the weekly board. It resets every Monday."
                  : "Take a reviewed quiz or win a battle to earn points and appear on the all-time board."
              }
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
          <GameProgressPanel
            progress={gameProgress}
            loading={gameProgressLoading}
            error={gameProgressError}
            isPro={Boolean(billingStatus?.is_pro)}
          />
          {ambassadorDashboard?.status !== "removed" && (
            <button className="ambassador-profile-link" onClick={() => navigate("ambassador")}>
              <span>
                <strong>
                  {ambassadorDashboard ? "Ambassador dashboard" : "Become a Rimbly Ambassador"}
                </strong>
                <small>
                  {ambassadorDashboard
                    ? "Share your link and track your rewards"
                    : "Earn ₦250 for every new student who completes their first quiz"}
                </small>
              </span>
              <span aria-hidden="true">→</span>
            </button>
          )}
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
                      hasReviewedQuiz={courseHasReviewedQuiz(course, papers, publishedQuizSets)}
                      onClick={() => {
                        setSelectedCourseId(course.id);
                        navigate("course");
                      }}
                    />
                  ))}
              </div>
            ) : (
              <EmptyState
                title="Build your personal course list"
                text="Save a course to keep its papers and quiz-ready status close at hand."
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
              <LoadingCards label="Loading published quizzes" />
            ) : prioritizedQuizSets.length ? (
              <div className="course-list quiz-catalog-grid">
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
              <button onClick={() => navigate("subscription")}>
                <span className="profile-menu-icon" aria-hidden="true">
                  ✦
                </span>
                <span className="profile-menu-copy">
                  <strong>Rimbly Pro</strong>
                  <small>
                    {billingStatus?.is_pro
                      ? "Manage your plan and view detailed analytics"
                      : "See plans, daily limits, and Pro benefits"}
                  </small>
                </span>
                <span className="profile-menu-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
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
    case "ambassador":
      title = "Ambassador";
      content = (
        <AmbassadorPage
          signedIn
          dashboard={ambassadorDashboard}
          loading={ambassadorLoading}
          error={ambassadorError}
          busy={ambassadorBusy}
          onAgree={() => void handleAgreeToAmbassadorTerms()}
          onRetry={() => setAmbassadorRetry((retry) => retry + 1)}
          onSignIn={() => navigate("login")}
          onNavigate={navigate}
        />
      );
      break;
    case "subscription":
      title = "Rimbly Pro";
      content = (
        <SubscriptionPage
          status={billingStatus}
          loading={billingStatusLoading}
          error={billingStatusError}
          paymentReference={new URLSearchParams(window.location.search).get("payment")}
          checkoutBusy={checkoutBusy}
          attempts={attempts}
          papers={papers}
          courses={courses}
          onRefresh={() => void refreshRimblyBillingStatus()}
          onChoosePlan={(planId) => void startProCheckout(planId)}
        />
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
        ambassadorAvailable={
          ambassadorDashboard !== null && ambassadorDashboard.status !== "removed"
        }
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

function AmbassadorPage({
  signedIn,
  dashboard,
  loading,
  error,
  busy,
  onAgree,
  onRetry,
  onSignIn,
  onNavigate,
}: {
  signedIn: boolean;
  dashboard: AmbassadorDashboard | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onAgree: () => void;
  onRetry: () => void;
  onSignIn: () => void;
  onNavigate: (route: Route) => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const inviteUrl = dashboard
    ? `${window.location.origin}/?route=signup&ref=${encodeURIComponent(dashboard.invite_code)}`
    : "";
  const shareText = `Join me on Rimbly for university-focused past questions and reviewed quizzes: ${inviteUrl}`;

  const copyText = async (value: string, copiedItem: "link" | "code") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(copiedItem);
      setCopyError(null);
      window.setTimeout(() => setCopied(null), 2000);
    } catch (copyFailure) {
      setCopyError(
        `${getErrorMessage(copyFailure, "Clipboard access is unavailable.")} Select and copy the ${copiedItem} manually.`,
      );
    }
  };

  const terms = [
    "Refer real students who are new to Rimbly.",
    "No fake, duplicate, or self-referrals.",
    "Rimbly may pause or change the program.",
    "Fraudulent referrals mean removal and no reward.",
  ];

  return (
    <div className="ambassador-page">
      <header className="ambassador-page-header">
        <button className="logo" onClick={() => onNavigate(signedIn ? "home" : "welcome")}>
          <span className="logo-mark" aria-hidden="true">
            <img src="/rimbly-icon.png" alt="" />
          </span>
          <span>Rimbly</span>
        </button>
        {!signedIn && (
          <button className="ambassador-signin" onClick={onSignIn}>
            Already a student? Sign in
          </button>
        )}
      </header>

      <main>
        <section className="ambassador-hero">
          <span className="eyebrow">Rimbly Student Ambassador Program</span>
          <h1>Invite students. Earn ₦250 for every first quiz.</h1>
          <p>
            Earn ₦250 for every new student who joins with your link and completes their first
            reviewed quiz. Empty accounts don’t earn a reward.
          </p>
          <div className="ambassador-reward-highlight">
            <strong>₦250</strong>
            <span>per activated student</span>
            <small>Activated = signed up and completed at least one reviewed quiz.</small>
          </div>
          {loading ? (
            <p className="field-note" role="status">
              Checking your ambassador status…
            </p>
          ) : dashboard?.status === "active" ? (
            <a className="btn btn-primary ambassador-dashboard-jump" href="#ambassador-dashboard">
              Open your invite dashboard ↓
            </a>
          ) : signedIn && dashboard?.status === "paused" ? (
            <p className="ambassador-status-message" role="status">
              Your ambassador account is paused. Your existing referral history is safe, but your
              invite link can’t bring in new referrals right now.
            </p>
          ) : signedIn && dashboard?.status === "removed" ? (
            <p className="ambassador-status-message removed" role="status">
              Your ambassador access has been removed. Contact Rimbly support if you think this was
              a mistake.
            </p>
          ) : signedIn && dashboard ? (
            <p className="ambassador-status-message" role="status">
              Your invite link is inactive while the program is paused.
            </p>
          ) : signedIn && error ? (
            <div className="ambassador-consent">
              <p className="app-feedback" role="alert">
                {error}
              </p>
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            </div>
          ) : signedIn ? (
            <div className="ambassador-consent">
              <label>
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <span>I agree to the Ambassador rules above.</span>
              </label>
              <Button disabled={!accepted || busy} onClick={onAgree}>
                {busy ? "Creating your invite link…" : "Agree & Get My Invite Link"}
              </Button>
              {error && (
                <p className="app-feedback" role="alert">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <Button onClick={onAgree}>Start application</Button>
          )}
        </section>

        {dashboard?.status === "active" && (
          <section className="ambassador-dashboard" id="ambassador-dashboard">
            <div className="section-title">
              <div>
                <span>Welcome to the program</span>
                <h2>Your ambassador dashboard</h2>
              </div>
              <span className="badge badge-green">Active</span>
            </div>
            <div className="ambassador-invite-card">
              <div>
                <span className="eyebrow">Your invite code</span>
                <strong className="ambassador-code">{dashboard.invite_code}</strong>
              </div>
              <label>
                <span>Your unique invite link</span>
                <input aria-label="Your unique invite link" readOnly value={inviteUrl} />
              </label>
              <div className="ambassador-share-actions">
                <Button variant="secondary" onClick={() => void copyText(inviteUrl, "link")}>
                  {copied === "link" ? "Link copied ✓" : "Copy invite link"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void copyText(dashboard.invite_code, "code")}
                >
                  {copied === "code" ? "Code copied ✓" : "Copy code"}
                </Button>
                <a
                  className="btn btn-secondary"
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Share on WhatsApp
                </a>
                <a
                  className="btn btn-secondary"
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Share on X
                </a>
              </div>
              {copyError && (
                <p className="app-feedback" role="alert">
                  {copyError}
                </p>
              )}
              <small>
                Earn only after a new student signs up with this link and completes their first
                reviewed quiz.
              </small>
            </div>
            <div className="ambassador-stats">
              <article>
                <strong>{dashboard.total_signups.toLocaleString()}</strong>
                <span>Signups</span>
              </article>
              <article>
                <strong>{dashboard.total_activated.toLocaleString()}</strong>
                <span>Activated students</span>
              </article>
              <article>
                <strong>₦{dashboard.total_earned.toLocaleString()}</strong>
                <span>Earned</span>
              </article>
            </div>
            <p className="ambassador-payout-note">
              Earnings show confirmed ₦250 rewards. Payment arrangements will be communicated by
              Rimbly; no payment is issued for an empty account.
            </p>
          </section>
        )}

        <section className="ambassador-how">
          <div className="section-title">
            <div>
              <span>Simple and transparent</span>
              <h2>How it works</h2>
            </div>
          </div>
          <div className="ambassador-steps">
            {[
              [
                "01",
                "Get your invite link",
                "Agree to the rules and get your unique link and code.",
              ],
              [
                "02",
                "Share with students",
                "Send it to course mates and students at your university.",
              ],
              [
                "03",
                "Earn ₦250",
                "Get credited when a new student completes their first reviewed quiz.",
              ],
            ].map(([number, title, description]) => (
              <article key={number}>
                <span>{number}</span>
                <strong>{title}</strong>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="ambassador-rules">
          <div>
            <span className="eyebrow">Clear rules</span>
            <h2>Built on trust.</h2>
            <p>Only genuine new students and completed first quizzes count.</p>
          </div>
          <ul>
            {terms.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="ambassador-footer">
        <button onClick={() => onNavigate(signedIn ? "home" : "welcome")}>← Back to Rimbly</button>
        {!signedIn && <button onClick={onSignIn}>Sign in to your account</button>}
      </footer>
    </div>
  );
}

function AdminActivationMetricsPanel() {
  const [metrics, setMetrics] = useState<AdminActivationMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMetrics(await getAdminActivationMetrics());
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Could not load activation metrics."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const medianSeconds = metrics?.median_seconds_to_activation ?? null;

  return (
    <section className="activation-metrics-panel" aria-labelledby="activation-metrics-title">
      <header className="admin-section-heading">
        <div>
          <span className="eyebrow">Activation measurement</span>
          <h2 id="activation-metrics-title">First reviewed quiz</h2>
        </div>
        <Button variant="secondary" disabled={loading} onClick={() => void loadMetrics()}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </header>
      {error ? (
        <div className="activation-metrics-error" role="alert">
          <p>{error}</p>
          <small>
            Apply <code>activation-measurement.sql</code> after the quiz migrations to enable this
            report.
          </small>
        </div>
      ) : loading ? (
        <p className="field-note" role="status">
          Loading first-quiz activation…
        </p>
      ) : metrics ? (
        <>
          <div className="activation-metrics-grid">
            <article>
              <small>Eligible signups (90s+)</small>
              <strong>{metrics.total_signups.toLocaleString()}</strong>
            </article>
            <article>
              <small>Completed a reviewed quiz</small>
              <strong>
                {metrics.activated_students.toLocaleString()} ·{" "}
                {metrics.activation_rate_percent.toFixed(1)}%
              </strong>
            </article>
            <article>
              <small>Median signup to answer review</small>
              <strong>
                {medianSeconds === null
                  ? "—"
                  : medianSeconds < 60
                    ? `${Math.round(medianSeconds)} sec`
                    : `${(medianSeconds / 60).toFixed(1)} min`}
              </strong>
            </article>
            <article>
              <small>Activated within 90 seconds</small>
              <strong>
                {metrics.under_90_seconds_percent === null
                  ? "—"
                  : `${metrics.under_90_seconds_percent.toFixed(1)}%`}
              </strong>
            </article>
          </div>
          <p className="activation-metrics-note">
            Activation means completing a reviewed quiz and successfully loading its answer review.
            The rate includes accounts created after tracking began with at least 90 seconds to
            activate. A private account ID deduplicates events; reports are aggregate and contain no
            answer content.
          </p>
        </>
      ) : (
        <p className="field-note">No activation report is available.</p>
      )}
    </section>
  );
}

function AdminPaperEditor({
  paper,
  universities,
  saving,
  onCancel,
  onSave,
}: {
  paper: AdminPaper;
  universities: University[];
  saving: boolean;
  onCancel: () => void;
  onSave: (values: Omit<AdminPaperUpdateInput, "paperId">, file: File | null) => void;
}) {
  const standardLevels = [
    "100 Level",
    "200 Level",
    "300 Level",
    "400 Level",
    "500 Level",
    "Postgraduate",
  ];
  const levels = paper.course_level
    ? [...new Set([paper.course_level, ...standardLevels])]
    : standardLevels;
  const semesters = (current: string | null) =>
    current && !["First Semester", "Second Semester"].includes(current)
      ? [current, "First Semester", "Second Semester"]
      : ["First Semester", "Second Semester"];

  return (
    <form
      className="admin-form admin-paper-edit"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const file = values.get("replacement_file");
        onSave(
          {
            university: String(values.get("university") ?? ""),
            courseCode: String(values.get("course_code") ?? ""),
            courseTitle: String(values.get("course_title") ?? ""),
            faculty: String(values.get("faculty") ?? ""),
            department: String(values.get("department") ?? ""),
            level: String(values.get("level") ?? ""),
            courseSemester: String(values.get("course_semester") ?? ""),
            courseVerified: values.get("course_verified") === "on",
            academicSession: String(values.get("academic_session") ?? ""),
            semester: String(values.get("semester") ?? ""),
            examYear: Number(values.get("exam_year")),
            paperVerified: values.get("paper_verified") === "on",
          },
          file instanceof File && file.size ? file : null,
        );
      }}
    >
      <div>
        <h3>Edit past question</h3>
        <p>Course details are shared: changing them updates every paper linked to this course.</p>
      </div>
      <label>
        <span>University</span>
        <select name="university" required defaultValue={paper.university}>
          <option value="" disabled>
            Select university
          </option>
          {!universities.some((university) => university.name === paper.university) && (
            <option value={paper.university}>{paper.university}</option>
          )}
          {universities.map((university) => (
            <option value={university.name} key={university.id}>
              {university.name}
            </option>
          ))}
        </select>
      </label>
      <div className="form-two">
        <label>
          <span>Course code</span>
          <input name="course_code" required maxLength={40} defaultValue={paper.course_code} />
        </label>
        <label>
          <span>Course title</span>
          <input name="course_title" required maxLength={200} defaultValue={paper.course_title} />
        </label>
      </div>
      <div className="form-two">
        <label>
          <span>Faculty</span>
          <input name="faculty" maxLength={120} defaultValue={paper.course_faculty ?? ""} />
        </label>
        <label>
          <span>Department</span>
          <input name="department" maxLength={120} defaultValue={paper.course_department ?? ""} />
        </label>
      </div>
      <div className="form-two">
        <label>
          <span>Course level</span>
          <select name="level" defaultValue={paper.course_level ?? ""}>
            <option value="">Not specified</option>
            {levels.map((level) => (
              <option key={level}>{level}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Course semester</span>
          <select name="course_semester" defaultValue={paper.course_semester ?? ""}>
            <option value="">Not specified</option>
            {semesters(paper.course_semester).map((semester) => (
              <option key={semester}>{semester}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-two">
        <label>
          <span>Academic session</span>
          <input
            name="academic_session"
            required
            maxLength={40}
            defaultValue={paper.academic_session}
          />
        </label>
        <label>
          <span>Exam year</span>
          <input
            name="exam_year"
            type="number"
            min="1990"
            max={new Date().getFullYear() + 1}
            required
            defaultValue={paper.exam_year ?? ""}
          />
        </label>
      </div>
      <label>
        <span>Paper semester</span>
        <select name="semester" defaultValue={paper.semester ?? ""}>
          <option value="">Not specified</option>
          {semesters(paper.semester).map((semester) => (
            <option key={semester}>{semester}</option>
          ))}
        </select>
      </label>
      <label className="upload-area">
        <input
          name="replacement_file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        />
        <b>Replace source file (optional)</b>
        <small>Leave empty to keep the current file · PDF, JPG, or PNG · Up to 20 MB</small>
      </label>
      <div className="admin-paper-verification">
        <label>
          <input name="course_verified" type="checkbox" defaultChecked={paper.course_is_verified} />
          <span>Verified course listing</span>
        </label>
        <label>
          <input name="paper_verified" type="checkbox" defaultChecked={paper.paper_is_verified} />
          <span>Verified past paper</span>
        </label>
      </div>
      <div className="admin-actions">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving changes…" : "Save past question changes"}
        </Button>
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
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
    | "ambassadors"
    | "academics"
    | "maintenance"
    | "audit"
  >("overview");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [contributions, setContributions] = useState<AdminContribution[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [papers, setPapers] = useState<AdminPaper[]>([]);
  const [editingPaperId, setEditingPaperId] = useState<string | null>(null);
  const [paperSearch, setPaperSearch] = useState("");
  const [quizPapers, setQuizPapers] = useState<AdminQuizPaper[]>([]);
  const [adminQuizzes, setAdminQuizzes] = useState<AdminQuizSet[]>([]);
  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [team, setTeam] = useState<AdminTeamMember[]>([]);
  const [ambassadors, setAmbassadors] = useState<AdminAmbassador[]>([]);
  const [ambassadorsLoading, setAmbassadorsLoading] = useState(false);
  const [ambassadorsError, setAmbassadorsError] = useState<string | null>(null);
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
  const canViewAnalytics = Boolean(access?.permissions.includes("analytics.view"));
  const canManagePapers = Boolean(access?.permissions.includes("papers.manage"));
  const canEditAllContent = access?.role === "super_admin";
  const canManageQuizzes = Boolean(
    access?.permissions.includes("quiz.manage") || access?.permissions.includes("quiz.review"),
  );
  const canCreateQuizzes = Boolean(access?.permissions.includes("quiz.manage"));
  const canReviewQuizzes = Boolean(access?.permissions.includes("quiz.review"));
  const canManageStudents = Boolean(access?.permissions.includes("students.manage"));
  const canManageTeam = Boolean(access?.permissions.includes("team.manage"));
  const canManageAcademics = Boolean(access?.permissions.includes("academics.manage"));
  const canManageMaintenance = access?.role === "super_admin";
  const canManageAmbassadors = access?.role === "super_admin";

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
    if (!access || section !== "ambassadors" || !canManageAmbassadors) return;
    let active = true;
    setAmbassadorsLoading(true);
    setAmbassadorsError(null);
    void getAdminAmbassadors()
      .then((result) => {
        if (active) setAmbassadors(result);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setAmbassadorsError(
            loadError instanceof Error ? loadError.message : "Could not load ambassadors.",
          );
        }
      })
      .finally(() => {
        if (active) setAmbassadorsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [access, canManageAmbassadors, section]);

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

  const handleAdminPaperUpdate = async (
    paperId: string,
    values: Omit<AdminPaperUpdateInput, "paperId">,
    file: File | null,
  ) => {
    const paper = papers.find((item) => item.id === paperId);
    if (!paper) {
      setError("This past question is no longer available. Refresh and try again.");
      return;
    }

    setBusyId(`paper-edit:${paperId}`);
    setError(null);
    setNotice(null);
    let replacementPath: string | null = null;
    try {
      if (file) replacementPath = await uploadAdminPaperReplacement(file);
      try {
        await updateAdminPaper({
          ...values,
          paperId,
          replacementFilePath: replacementPath,
        });
      } catch (saveError) {
        let cleanupError: unknown = null;
        if (replacementPath) {
          try {
            await removeAdminPaperFile(replacementPath);
          } catch (error) {
            cleanupError = error;
          }
        }
        if (cleanupError) {
          console.error("Could not remove the unlinked replacement paper.", cleanupError);
          throw new Error(
            `${getErrorMessage(saveError, "Could not update this past question.")} The replacement upload could not be removed; contact support to clean up the unused file.`,
          );
        }
        throw saveError;
      }

      setEditingPaperId(null);
      setNotice("Past question details saved and recorded in the admin audit log.");
      try {
        setPapers(await getAdminPapers());
      } catch (refreshError) {
        setError(
          `Changes were saved, but the paper list could not be refreshed: ${getErrorMessage(refreshError, "reload the page")}`,
        );
      }
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Could not update this past question."));
    } finally {
      setBusyId(null);
    }
  };

  const visibleAdminPapers = papers.filter((paper) =>
    [paper.university, paper.course_code, paper.course_title, paper.academic_session, paper.status]
      .join(" ")
      .toLowerCase()
      .includes(paperSearch.trim().toLowerCase()),
  );

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

  const handleAmbassadorStatus = async (
    ambassador: AdminAmbassador,
    status: "active" | "paused" | "removed",
  ) => {
    const confirmed =
      status !== "removed" ||
      window.confirm(`Remove ambassador access for ${ambassador.full_name}?`);
    if (!confirmed) return;
    setBusyId(`ambassador:${ambassador.user_id}`);
    setAmbassadorsError(null);
    setNotice(null);
    try {
      await setAdminAmbassadorStatus(ambassador.user_id, status);
      setAmbassadors(await getAdminAmbassadors());
      setNotice(`Ambassador status updated to ${status}.`);
    } catch (statusError) {
      setAmbassadorsError(
        statusError instanceof Error ? statusError.message : "Could not update ambassador status.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const adminNav: { key: typeof section; label: string; visible: boolean }[] = [
    { key: "overview", label: "Overview", visible: canViewDashboard },
    { key: "contributions", label: "Review queue", visible: canReview },
    { key: "papers", label: "Past questions", visible: canManagePapers },
    { key: "quizzes", label: "Quiz authoring", visible: canManageQuizzes },
    { key: "students", label: "Students", visible: canManageStudents },
    { key: "team", label: "Team", visible: canManageTeam },
    { key: "ambassadors", label: "Ambassadors", visible: canManageAmbassadors },
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
              <>
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
                {canViewAnalytics && <AdminActivationMetricsPanel />}
              </>
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
                  <span>{visibleAdminPapers.length} shown</span>
                </div>
                <label className="admin-search">
                  <span className="sr-only">Search past questions</span>
                  <input
                    value={paperSearch}
                    onChange={(event) => setPaperSearch(event.target.value)}
                    placeholder="Search university, course, session, or status"
                  />
                </label>
                {visibleAdminPapers.length ? (
                  visibleAdminPapers.map((paper) => (
                    <div className="admin-paper-item" key={paper.id}>
                      <article className="admin-contribution">
                        <div>
                          <strong>
                            {paper.course_code} · {paper.course_title}
                          </strong>
                          <small>
                            {paper.university} · {paper.academic_session} · {paper.status}
                          </small>
                        </div>
                        {canEditAllContent && (
                          <Button
                            variant="secondary"
                            disabled={Boolean(busyId)}
                            onClick={() =>
                              setEditingPaperId((current) =>
                                current === paper.id ? null : paper.id,
                              )
                            }
                          >
                            {editingPaperId === paper.id ? "Close editor" : "Edit"}
                          </Button>
                        )}
                      </article>
                      {canEditAllContent && editingPaperId === paper.id && (
                        <AdminPaperEditor
                          paper={paper}
                          universities={universities}
                          saving={busyId === `paper-edit:${paper.id}`}
                          onCancel={() => setEditingPaperId(null)}
                          onSave={(values, file) =>
                            void handleAdminPaperUpdate(paper.id, values, file)
                          }
                        />
                      )}
                    </div>
                  ))
                ) : papers.length ? (
                  <EmptyState
                    title="No matching past questions"
                    text="Try another university, course code, title, session, or status."
                  />
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
                canEditAll={canEditAllContent}
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
            {section === "ambassadors" && canManageAmbassadors && (
              <section className="admin-review-list">
                <div className="admin-section-heading">
                  <div>
                    <span className="eyebrow">Student referral program</span>
                    <h2>Ambassadors</h2>
                  </div>
                  <span>{ambassadors.length} ambassadors</span>
                </div>
                {ambassadorsError && (
                  <p className="app-feedback" role="alert">
                    {ambassadorsError}
                  </p>
                )}
                {ambassadorsLoading ? (
                  <p className="field-note" role="status">
                    Loading ambassador accounts…
                  </p>
                ) : ambassadors.length ? (
                  ambassadors.map((ambassador) => (
                    <article
                      className="admin-contribution admin-ambassador-row"
                      key={ambassador.user_id}
                    >
                      <div>
                        <strong>{ambassador.full_name}</strong>
                        <small>
                          {ambassador.email} · {ambassador.invite_code} · Joined program{" "}
                          {new Date(ambassador.agreed_at).toLocaleDateString()}
                        </small>
                        <small>
                          {ambassador.total_signups} signups · {ambassador.total_activated}{" "}
                          activated
                          {" · "}₦{ambassador.total_earned.toLocaleString()} earned
                        </small>
                      </div>
                      <span
                        className={`badge ${ambassador.status === "active" ? "badge-green" : "badge-amber"}`}
                      >
                        {ambassador.status}
                      </span>
                      <div className="admin-actions">
                        {ambassador.status !== "active" && (
                          <Button
                            variant="secondary"
                            disabled={Boolean(busyId)}
                            onClick={() => void handleAmbassadorStatus(ambassador, "active")}
                          >
                            Restore
                          </Button>
                        )}
                        {ambassador.status === "active" && (
                          <Button
                            variant="secondary"
                            disabled={Boolean(busyId)}
                            onClick={() => void handleAmbassadorStatus(ambassador, "paused")}
                          >
                            Pause
                          </Button>
                        )}
                        {ambassador.status !== "removed" && (
                          <Button
                            variant="secondary"
                            disabled={Boolean(busyId)}
                            onClick={() => void handleAmbassadorStatus(ambassador, "removed")}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <EmptyState
                    title="No ambassadors yet"
                    text="Students who agree to the program rules will appear here."
                  />
                )}
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

function Stat({
  icon,
  value,
  label,
  tone,
}: {
  icon: string;
  value: string;
  label: string;
  tone?: "hot";
}) {
  return (
    <div className={`stat-card ${tone ?? ""}`}>
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
  canEditAll,
  onRefresh,
}: {
  quizzes: AdminQuizSet[];
  papers: AdminQuizPaper[];
  universities: University[];
  userId: string;
  canManage: boolean;
  canReview: boolean;
  canEditAll: boolean;
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
    const publishImmediately =
      submitter instanceof HTMLButtonElement && submitter.value === "publish_quiz";
    const publishConfirmation = revisionParentId
      ? "Publish this revision now? This skips the second-reviewer step and archives the previous version. Confirm that you have checked every question, answer, and explanation."
      : "Publish this quiz now? This skips the second-reviewer step. Confirm that you have checked every question, answer, and explanation.";
    if (publishImmediately && !window.confirm(publishConfirmation)) return;

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
            ? "Revision submitted for review. The current published quiz stays available until a reviewer publishes the revision."
            : "Submitted for human review. A different reviewer must approve it before students can see it.",
        );
      } else if (publishImmediately) {
        await publishAdminQuiz(savedId);
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
            ? "Quiz revision published. The previous version was archived and its history preserved."
            : "Quiz published and available to students across departments and universities.",
        );
      } else {
        await onRefresh();
        setNotice(
          reviewingQuiz
            ? "Review edits saved. Only questions marked approved can be published."
            : revisionParentId
              ? "Revision draft saved. The current published quiz stays available until you publish this revision or a reviewer approves it."
              : "Draft saved. It will not be visible to students until you request publication.",
        );
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : submitForReview
            ? "Could not save and submit this quiz for review."
            : publishImmediately
              ? "Could not publish this quiz. Check that every question has a correct answer."
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
      if (createRevision && canEditAll) await takeOverAdminQuizDraft(draftId);
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
            ? "Edit this revision, then publish it yourself or send it for a separate review. The current version stays live until the revision is published."
            : "Draft loaded for editing.",
      );
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load this quiz draft.");
    } finally {
      setSaving(false);
    }
  };

  const editQuiz = async (quiz: AdminQuizSet) => {
    const anotherCreator = quiz.created_by !== userId;
    if (anotherCreator && canEditAll && ["draft", "needs_revision"].includes(quiz.status)) {
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        await takeOverAdminQuizDraft(quiz.id);
        await onRefresh();
        await editDraft(quiz.id);
      } catch (takeoverError) {
        setError(
          takeoverError instanceof Error
            ? takeoverError.message
            : "Could not take over this quiz draft.",
        );
        setSaving(false);
      }
      return;
    }

    await editDraft(quiz.id, false, quiz.status === "published");
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
            JSON. Saving alone leaves a draft. Use “Save and request review” for another reviewer,
            or use “Publish quiz” after confirming the question and answer key yourself.
            {revisionParentId && " Publishing this revision archives the previous version."}
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
              <Button type="submit" variant="secondary" disabled={saving}>
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
                <>
                  <Button
                    type="submit"
                    variant="secondary"
                    name="submit_action"
                    value="request_review"
                    disabled={saving}
                  >
                    {saving ? "Submitting…" : "Save and request review"}
                  </Button>
                  <Button type="submit" name="submit_action" value="publish_quiz" disabled={saving}>
                    {saving ? "Publishing…" : "Publish quiz"}
                  </Button>
                </>
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
                    Revision draft. The current version remains available until this revision is
                    published.
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
              {(canManage || canEditAll) &&
                (quiz.created_by === userId || canEditAll) &&
                ["draft", "needs_revision"].includes(quiz.status) && (
                  <>
                    <Button
                      variant="secondary"
                      disabled={saving || quiz.id === savedQuizId}
                      onClick={() => void editQuiz(quiz)}
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
              {(canManage || canEditAll) &&
                (quiz.created_by === userId || canEditAll) &&
                quiz.status === "published" &&
                !quizzes.some(
                  (revision) =>
                    revision.replaces_quiz_id === quiz.id &&
                    ["draft", "needs_revision", "pending_review"].includes(revision.status),
                ) && (
                  <Button variant="secondary" disabled={saving} onClick={() => void editQuiz(quiz)}>
                    Edit quiz
                  </Button>
                )}
              {(canManage || canEditAll) && (quiz.created_by === userId || canEditAll) && (
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
            text="Create a question set with or without a source paper. Save and request review, or publish it yourself after checking every answer."
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
  quizzes,
  loading,
  university,
  onQuiz,
  onSelect,
  onNavigate,
}: {
  courses: Course[];
  papers: Paper[];
  quizzes: QuizSet[];
  loading: boolean;
  university: string | null;
  onQuiz: () => void;
  onSelect: (course: Course) => void;
  onNavigate: (route: Route) => void;
}) {
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [faculty, setFaculty] = useState("");
  const [department, setDepartment] = useState("");
  const [scope, setScope] = useState<"university" | "all">(university ? "university" : "all");
  const levels = Array.from(
    new Set(courses.map((course) => course.level).filter((value): value is string => !!value)),
  ).sort((a, b) => a.localeCompare(b));
  const faculties = Array.from(
    new Set(courses.map((course) => course.faculty).filter((value): value is string => !!value)),
  ).sort((a, b) => a.localeCompare(b));
  const departments = Array.from(
    new Set(courses.map((course) => course.department).filter((value): value is string => !!value)),
  ).sort((a, b) => a.localeCompare(b));
  const displayed = courses.filter((course) => {
    const matchesSearch =
      `${course.code} ${course.title} ${course.department ?? ""} ${course.university}`
        .toLowerCase()
        .includes(search.trim().toLowerCase());
    return (
      (scope === "all" ||
        normalizeCatalogLabel(course.university) === normalizeCatalogLabel(university)) &&
      matchesSearch &&
      (!level || course.level === level) &&
      (!faculty || course.faculty === faculty) &&
      (!department || course.department === department)
    );
  });
  const hasFilters = Boolean(search.trim() || level || faculty || department);
  const hasUniversityCourses = courses.some(
    (course) => normalizeCatalogLabel(course.university) === normalizeCatalogLabel(university),
  );
  const clearFilters = () => {
    setSearch("");
    setLevel("");
    setFaculty("");
    setDepartment("");
  };
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Past questions library</span>
        <h1>Find your next practice.</h1>
        <p>Start with courses at your university, or switch to the full library.</p>
        <Button onClick={onQuiz}>Take a published quiz</Button>
      </div>
      <div className="segment course-scope-toggle" role="group" aria-label="Course library scope">
        <button
          type="button"
          className={scope === "university" ? "active" : ""}
          aria-pressed={scope === "university"}
          onClick={() => setScope("university")}
        >
          My university
        </button>
        <button
          type="button"
          className={scope === "all" ? "active" : ""}
          aria-pressed={scope === "all"}
          onClick={() => setScope("all")}
        >
          All universities
        </button>
      </div>
      <label className="search-field">
        <span aria-hidden="true">⌕</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search course code, title, department, or university"
        />
      </label>
      <div className="practice-filters" aria-label="Filter courses">
        <label>
          <span>Level</span>
          <select value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">All levels</option>
            {levels.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Faculty</span>
          <select value={faculty} onChange={(event) => setFaculty(event.target.value)}>
            <option value="">All faculties</option>
            {faculties.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Department</span>
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="">All departments</option>
            {departments.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        {hasFilters && (
          <button type="button" className="clear-filters" onClick={clearFilters}>
            Clear filters
          </button>
        )}
        {hasFilters && (
          <div className="practice-filter-chips" aria-label="Active course filters">
            {search.trim() && (
              <button type="button" onClick={() => setSearch("")}>
                Search: {search.trim()} <span aria-hidden="true">×</span>
              </button>
            )}
            {level && (
              <button type="button" onClick={() => setLevel("")}>
                {level} <span aria-hidden="true">×</span>
              </button>
            )}
            {faculty && (
              <button type="button" onClick={() => setFaculty("")}>
                {faculty} <span aria-hidden="true">×</span>
              </button>
            )}
            {department && (
              <button type="button" onClick={() => setDepartment("")}>
                {department} <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
        )}
      </div>
      <section>
        <div className="section-title">
          <div>
            <span>
              {displayed.length} {displayed.length === 1 ? "course" : "courses"}
            </span>
            <h2>Courses in the library</h2>
          </div>
        </div>
        {displayed.length ? (
          <div className="course-list">
            {displayed.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                paperCount={papers.filter((paper) => paper.course_id === course.id).length}
                hasReviewedQuiz={courseHasReviewedQuiz(course, papers, quizzes)}
                onClick={() => onSelect(course)}
              />
            ))}
          </div>
        ) : loading ? (
          <LoadingCards label="Loading courses in the practice library" />
        ) : (
          <EmptyState
            title={
              !courses.length
                ? "The library is empty"
                : scope === "university" && !hasUniversityCourses
                  ? "No courses at your university yet"
                  : "No matching courses"
            }
            text={
              !courses.length
                ? "Ask an administrator to add courses to the study library."
                : scope === "university" && !hasUniversityCourses
                  ? "Explore courses from other universities while your local library grows."
                  : "Try a different search term or adjust your filters."
            }
            action={
              !courses.length
                ? "Contribute a paper"
                : scope === "university" && !hasUniversityCourses
                  ? "Browse all universities"
                  : "Clear filters"
            }
            onAction={() =>
              !courses.length
                ? onNavigate("contribute")
                : scope === "university" && !hasUniversityCourses
                  ? setScope("all")
                  : clearFilters()
            }
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
  onBillingRefresh,
}: {
  userId: string;
  university: string | null;
  onActivityRefresh: () => Promise<void>;
  onBillingRefresh: () => Promise<void>;
}) {
  const [quizzes, setQuizzes] = useState<QuizSet[]>([]);
  const [opponents, setOpponents] = useState<Awaited<ReturnType<typeof getBattleOpponents>>>([]);
  const [opponentsLoading, setOpponentsLoading] = useState(false);
  const [opponentsOpen, setOpponentsOpen] = useState(false);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [battlesLoading, setBattlesLoading] = useState(true);
  const [universityBattleActivity, setUniversityBattleActivity] =
    useState<UniversityBattleActivity | null>(null);
  const [universityBattleActivityLoading, setUniversityBattleActivityLoading] = useState(true);
  const [universityBattleActivityError, setUniversityBattleActivityError] = useState<string | null>(
    null,
  );
  const [linkedInvite, setLinkedInvite] = useState<{
    battleId: string;
    invite: OpenBattleInvite;
  } | null>(null);
  const [linkedInviteLoading, setLinkedInviteLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [quizId, setQuizId] = useState("");
  const [activeBattleId, setActiveBattleId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const linkedChallengeId = new URLSearchParams(window.location.search).get("challenge");
  const previousBattlesRef = useRef<Battle[]>([]);
  const opponentSearchRef = useRef<HTMLInputElement | null>(null);
  const linkedInviteRequestedRef = useRef<string | null>(null);

  const refreshUniversityBattleActivity = async () => {
    try {
      setUniversityBattleActivity(await getUniversityBattleActivity());
      setUniversityBattleActivityError(null);
    } catch (activityError) {
      setUniversityBattleActivityError(
        activityError instanceof Error
          ? activityError.message
          : "Could not load university battle activity.",
      );
    } finally {
      setUniversityBattleActivityLoading(false);
    }
  };

  const refreshBattles = async () => {
    setBattles(await getBattles());
  };

  const refreshBattlesAfterAction = async (action: string) => {
    try {
      await refreshBattles();
    } catch (refreshError) {
      setError(
        `${action}, but the battle list could not refresh: ${refreshError instanceof Error ? refreshError.message : "unknown error"}`,
      );
    }
  };

  const refreshActivitySummary = async () => {
    try {
      await onActivityRefresh();
    } catch (refreshError) {
      setError(
        `Battle result saved, but your progress could not refresh: ${refreshError instanceof Error ? refreshError.message : "unknown error"}`,
      );
    }
  };

  const copyChallengeLink = async (
    battleId: string,
    openInvite = battles.find((battle) => battle.id === battleId)?.challenged_id === null,
  ) => {
    const inviteUrl = new URL(window.location.href);
    inviteUrl.searchParams.set("route", "battle");
    inviteUrl.searchParams.set("challenge", battleId);
    try {
      await navigator.clipboard.writeText(inviteUrl.toString());
      setError(null);
      setNotice(
        openInvite
          ? "Challenge link copied. Share it with an active student at your university; the invite expires in 7 days."
          : "Challenge link copied. Share it with the classmate you challenged.",
      );
    } catch (copyError) {
      setError(
        copyError instanceof Error
          ? `The challenge is ready, but the link could not be copied: ${copyError.message}`
          : "The challenge is ready, but this browser could not copy the link.",
      );
    }
  };

  useEffect(() => {
    if (!linkedChallengeId || !battles.length) return;
    document
      .getElementById(`battle-${linkedChallengeId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [battles.length, linkedChallengeId]);

  useEffect(() => {
    if (!linkedChallengeId || battlesLoading) return;
    if (battles.some((battle) => battle.id === linkedChallengeId)) {
      setLinkedInvite(null);
      return;
    }
    if (linkedInviteRequestedRef.current === linkedChallengeId) return;

    let active = true;
    linkedInviteRequestedRef.current = linkedChallengeId;
    setLinkedInviteLoading(true);
    void getOpenBattleChallenge(linkedChallengeId)
      .then((invite) => {
        if (active) setLinkedInvite({ battleId: linkedChallengeId, invite });
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load this battle invite.",
          );
        }
      })
      .finally(() => {
        if (active) setLinkedInviteLoading(false);
      });
    return () => {
      active = false;
    };
  }, [battles, battlesLoading, linkedChallengeId]);

  useEffect(() => {
    let active = true;
    void Promise.all([getPublishedQuizSets(), getBattles()])
      .then(([nextQuizzes, nextBattles]) => {
        if (!active) return;
        setQuizzes(nextQuizzes);
        previousBattlesRef.current = nextBattles;
        setBattles(nextBattles);
      })
      .catch((loadError: unknown) => {
        if (active)
          setError(
            loadError instanceof Error ? loadError.message : "Could not load the battle arena.",
          );
      })
      .finally(() => {
        if (active) setBattlesLoading(false);
      });
    const interval = window.setInterval(() => {
      void getBattles()
        .then((result) => {
          if (!active) return;
          const newlyCompleted = result.some(
            (battle) =>
              battle.status === "completed" &&
              previousBattlesRef.current.some(
                (previous) => previous.id === battle.id && previous.status !== "completed",
              ),
          );
          previousBattlesRef.current = result;
          setBattles(result);
          if (newlyCompleted) {
            void refreshActivitySummary();
            void refreshUniversityBattleActivity();
          }
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
    setUniversityBattleActivityLoading(true);
    setUniversityBattleActivityError(null);
    void getUniversityBattleActivity()
      .then((activity) => {
        if (active) setUniversityBattleActivity(activity);
      })
      .catch((activityError: unknown) => {
        if (active) {
          setUniversityBattleActivityError(
            activityError instanceof Error
              ? activityError.message
              : "Could not load university battle activity.",
          );
        }
      })
      .finally(() => {
        if (active) setUniversityBattleActivityLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!opponentsOpen) return;
    let active = true;
    setOpponentsLoading(true);
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
        })
        .finally(() => {
          if (active) setOpponentsLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [opponentsOpen, search]);

  const respond = async (battleId: string, accept: boolean) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await respondToBattle(battleId, accept);
      setNotice(
        accept ? "Challenge accepted. You can start the shared quiz now." : "Challenge declined.",
      );
      await refreshBattlesAfterAction(accept ? "Challenge accepted" : "Challenge declined");
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
      await refreshBattlesAfterAction("Challenge sent");
      await onBillingRefresh();
      setNotice("Challenge sent. Your opponent will get the same questions when they accept.");
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Could not send this challenge.",
      );
    } finally {
      setBusy(false);
    }
  };

  const createOpenInvite = async () => {
    if (!quizId) {
      setError("Choose a published quiz for your challenge.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const battleId = await createOpenBattleChallenge(quizId);
      await refreshBattlesAfterAction("Invite created");
      await onBillingRefresh();
      await copyChallengeLink(battleId, true);
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Could not create this battle invite.",
      );
    } finally {
      setBusy(false);
    }
  };

  const acceptLinkedInvite = async () => {
    if (!linkedInvite || linkedInvite.invite.status !== "open") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await acceptOpenBattleChallenge(linkedInvite.battleId);
      setLinkedInvite(null);
      await refreshBattlesAfterAction("Battle invite accepted");
      setNotice("Invite accepted. Start the shared quiz from your recent battles.");
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Could not accept this battle invite.",
      );
    } finally {
      setBusy(false);
    }
  };

  const rematch = async (battle: Battle) => {
    if (!battle.challenged_id) return;
    const opponentId =
      battle.challenger_id === userId ? battle.challenged_id : battle.challenger_id;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createBattle(battle.quiz_id, opponentId);
      await refreshBattlesAfterAction("Rematch sent");
      await onBillingRefresh();
      setNotice(
        `Rematch requested with ${battle.challenger_id === userId ? battle.challenged_name : battle.challenger_name}.`,
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not send this rematch.");
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
      await refreshBattlesAfterAction("Battle answers saved");
      await refreshActivitySummary();
      await refreshUniversityBattleActivity();
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
          <span className="eyebrow">
            {university || "University"} · one-on-one · same questions
          </span>
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
                  aria-pressed={answers[question.id] === index}
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
          Same reviewed quiz for both players. Earn 10 points per correct answer, plus 25 for a win
          or 8 for a draw. Correct answers decide the winner, then faster time.
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
      <UniversityBattleActivityCard
        university={university}
        activity={universityBattleActivity}
        loading={universityBattleActivityLoading}
        error={universityBattleActivityError}
      />
      <section className="battle-challenge-panel">
        <div>
          <span className="eyebrow">Your university</span>
          <h2>{university || "Complete your university profile to find players"}</h2>
          <p>Direct challenges wait for a response. Shareable invite links expire after 7 days.</p>
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
        <div className="battle-open-invite-action">
          <Button
            variant="secondary"
            disabled={busy || !quizId}
            onClick={() => void createOpenInvite()}
          >
            Create shareable invite link
          </Button>
          <small>Anyone with the link at your university can accept the challenge.</small>
        </div>
        <details
          className="battle-opponent-disclosure"
          open={opponentsOpen}
          onToggle={(event) => setOpponentsOpen(event.currentTarget.open)}
        >
          <summary>
            <span>Challenge a student</span>
            <small>Browse classmates at your university</small>
          </summary>
          <label className="search-field">
            <span className="sr-only">Find a player at your university</span>
            <span aria-hidden="true">⌕</span>
            <input
              ref={opponentSearchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a player at your university"
            />
          </label>
          {opponentsLoading ? (
            <p className="field-note" role="status">
              Finding students at your university…
            </p>
          ) : opponents.length ? (
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
                  <Button
                    disabled={busy || !quizId}
                    onClick={() => void challenge(opponent.user_id)}
                  >
                    Challenge
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <p className="field-note">
              No classmates found right now. Create a shareable link to challenge someone later.
            </p>
          )}
        </details>
      </section>
      {linkedInviteLoading && (
        <p className="field-note" role="status">
          Checking this battle invite…
        </p>
      )}
      {linkedInvite && (
        <section className="battle-linked-invite">
          <span className="eyebrow">University battle invite</span>
          <h2>
            {linkedInvite.invite.status === "open"
              ? "You’ve been challenged."
              : linkedInvite.invite.status === "owner"
                ? "This is your invite link."
                : linkedInvite.invite.status === "expired"
                  ? "This invite has expired."
                  : linkedInvite.invite.status === "claimed"
                    ? "This invite has already been claimed."
                    : "This invite is no longer available."}
          </h2>
          <p>
            {linkedInvite.invite.quiz_title} · {linkedInvite.invite.challenger_name} ·{" "}
            {linkedInvite.invite.university}
          </p>
          {linkedInvite.invite.status === "open" && (
            <Button disabled={busy} onClick={() => void acceptLinkedInvite()}>
              {busy ? "Accepting…" : "Accept and play"}
            </Button>
          )}
          {linkedInvite.invite.status === "owner" && (
            <Button
              variant="secondary"
              onClick={() => void copyChallengeLink(linkedInvite.battleId, true)}
            >
              Copy invite link
            </Button>
          )}
          {linkedInvite.invite.status === "expired" && (
            <small>Invite links can be accepted within 7 days of being created.</small>
          )}
        </section>
      )}
      <section className="battle-matches">
        <div className="admin-section-heading">
          <div>
            <span className="eyebrow">Your activity</span>
            <h2>Recent battles</h2>
          </div>
          <Button variant="secondary" disabled={busy} onClick={() => void refreshBattles()}>
            Refresh
          </Button>
        </div>
        {battlesLoading ? (
          <p className="field-note" role="status">
            Loading your recent battles…
          </p>
        ) : battles.length ? (
          battles.map((battle) => {
            const incoming = battle.challenged_id === userId && battle.status === "pending";
            const outgoing = battle.challenger_id === userId && battle.status === "pending";
            const otherName =
              battle.challenger_id === userId
                ? battle.challenged_name || "a classmate"
                : battle.challenger_name;
            const statusLabel = incoming
              ? "Your turn"
              : outgoing
                ? battle.challenged_id
                  ? "Waiting for response"
                  : "Open invite · 7 days"
                : battle.status === "active"
                  ? "In progress"
                  : battle.status === "completed"
                    ? "Completed"
                    : battle.status === "expired"
                      ? "Expired"
                      : battle.status === "declined"
                        ? "Declined"
                        : "Cancelled";
            return (
              <article
                className={`battle-match-row ${battle.id === linkedChallengeId ? "battle-invite-target" : ""} ${battle.status === "completed" && battle.winner_id === userId ? "battle-won" : ""}`}
                id={`battle-${battle.id}`}
                key={battle.id}
              >
                <div>
                  <strong>{battle.quiz_title}</strong>
                  <small>
                    {incoming ? `${otherName} challenged you` : `Challenge with ${otherName}`}
                    {" · "}
                    {new Date(battle.created_at).toLocaleDateString()}
                  </small>
                </div>
                <span
                  className={`badge ${battle.status === "completed" ? "badge-purple" : battle.status === "expired" || battle.status === "cancelled" ? "badge-red" : "badge-amber"}`}
                  aria-label={`Battle status: ${statusLabel}`}
                >
                  {statusLabel}
                </span>
                {incoming && (
                  <>
                    <Button
                      disabled={busy}
                      ariaLabel={`Accept challenge from ${otherName}`}
                      onClick={() => void respond(battle.id, true)}
                    >
                      Accept
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      ariaLabel={`Decline challenge from ${otherName}`}
                      onClick={() => void respond(battle.id, false)}
                    >
                      Decline
                    </Button>
                  </>
                )}
                {outgoing && (
                  <>
                    <Button
                      variant="secondary"
                      ariaLabel={
                        battle.challenged_id
                          ? `Copy invite link for ${otherName}`
                          : "Copy university battle invite link"
                      }
                      onClick={() => void copyChallengeLink(battle.id)}
                    >
                      Copy invite link
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          await cancelBattle(battle.id);
                          await refreshBattlesAfterAction("Challenge cancelled");
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
                  </>
                )}
                {battle.status === "active" && !battle.your_submission && (
                  <Button
                    disabled={busy}
                    ariaLabel={`Play battle with ${otherName}`}
                    onClick={() => void startBattle(battle.id)}
                  >
                    Play
                  </Button>
                )}
                {battle.status === "active" && battle.your_submission && (
                  <small>
                    {battle.opponent_submission
                      ? "Your opponent has submitted · waiting for results"
                      : "You’ve submitted · waiting for your opponent"}
                  </small>
                )}
                {battle.status === "active" &&
                  !battle.your_submission &&
                  battle.opponent_submission && (
                    <small>Your opponent has submitted · it’s your turn</small>
                  )}
                {battle.status === "completed" && (
                  <>
                    <div className="battle-match-result">
                      <strong>
                        {battle.is_draw
                          ? "Draw"
                          : battle.winner_id === userId
                            ? "Victory"
                            : "Defeat"}
                      </strong>
                      {battle.winner_id === userId && (
                        <span className="battle-victory-check" aria-label="Victory">
                          ✓
                        </span>
                      )}
                      <small>
                        You {battle.your_correct_count ?? 0} correct in{" "}
                        {(battle.your_duration_seconds ?? 0).toFixed(2)}s{" · "}
                        opponent {battle.opponent_correct_count ?? 0} correct in{" "}
                        {(battle.opponent_duration_seconds ?? 0).toFixed(2)}s
                      </small>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      ariaLabel={`Rematch ${otherName} in ${battle.quiz_title}`}
                      onClick={() => void rematch(battle)}
                    >
                      Rematch
                    </Button>
                  </>
                )}
              </article>
            );
          })
        ) : (
          <EmptyState
            title="Be the first to start a battle"
            text="Start a direct challenge or create a shareable university invite link for someone to accept later."
            action="Find a classmate"
            onAction={() => {
              setOpponentsOpen(true);
              window.setTimeout(() => opponentSearchRef.current?.focus(), 0);
            }}
          />
        )}
      </section>
    </div>
  );
}

function PaperRow({
  paper,
  course,
  onClick,
}: {
  paper: Paper;
  course: Course;
  onClick: () => void;
}) {
  return (
    <button className="paper-row" onClick={onClick}>
      <span className="file-tile">▤</span>
      <span>
        <b>Session: {paper.academic_session || "Not specified"}</b>
        <small>
          Department: {course.department || "Not specified"} · Level:{" "}
          {course.level || "Not specified"}
        </small>
        <small>
          Semester: {paper.semester || course.semester || "Not specified"} · Exam year:{" "}
          {paper.exam_year ?? "Not specified"}
        </small>
      </span>
      <span className={`badge ${paper.is_verified ? "badge-green" : ""}`}>
        {paper.is_verified ? "Verified paper" : "Published · not verified"}
      </span>
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
          <h1>{paper.academic_session || "Past paper"}</h1>
          <p>
            {course.title} · Department: {course.department || "Not specified"} · Level:{" "}
            {course.level || "Not specified"}
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
            <dt>Department</dt>
            <dd>{course.department || "Not specified"}</dd>
          </div>
          <div>
            <dt>Course</dt>
            <dd>
              {course.code} · {course.title}
            </dd>
          </div>
          <div>
            <dt>Level</dt>
            <dd>{course.level || "Not specified"}</dd>
          </div>
          <div>
            <dt>Academic session</dt>
            <dd>{paper.academic_session || "Not specified"}</dd>
          </div>
          <div>
            <dt>Exam year</dt>
            <dd>{paper.exam_year ?? "Not specified"}</dd>
          </div>
          <div>
            <dt>Semester</dt>
            <dd>{paper.semester || course.semester || "Not specified"}</dd>
          </div>
          <div>
            <dt>Pages</dt>
            <dd>{paper.page_count ?? "Not specified"}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{paper.is_verified ? "Verified source paper" : "Published source paper"}</dd>
          </div>
          <div>
            <dt>Question set</dt>
            <dd>
              {quizStatus === "ready"
                ? "Reviewed questions available"
                : quizStatus === "missing"
                  ? "Original paper only · no reviewed quiz yet"
                  : quizStatus === "error"
                    ? "Could not check for reviewed questions"
                    : "Checking for reviewed questions…"}
            </dd>
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
          <p>
            Take the reviewed quiz when available, or create a shareable university battle invite.
          </p>
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
                ? "Quiz not ready yet"
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
  quizTitle,
  university,
  answers,
  busy,
  setAnswer,
  onSubmit,
}: {
  questions: PublicQuestion[];
  quizTitle: string;
  university: string;
  answers: Record<string, number>;
  busy: boolean;
  setAnswer: (questionId: string, index: number) => void;
  onSubmit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const question = questions[index];
  const options = Array.isArray(question.options) ? question.options : [];
  const answered = Object.keys(answers).length;
  const progressPercent = ((index + 1) / questions.length) * 100;
  return (
    <div className="focus-page">
      <header>
        <div className="quiz-session-context">
          <strong>{quizTitle}</strong>
          <small>{university}</small>
        </div>
        <div className="quiz-progress-meta">
          <span>
            Question {index + 1} of {questions.length}
          </span>
          <div
            className="progress"
            role="progressbar"
            aria-label="Quiz question progress"
            aria-valuemin={1}
            aria-valuemax={questions.length}
            aria-valuenow={index + 1}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => {
            if (!answered || window.confirm("Exit this quiz? Your answers will not be saved.")) {
              window.history.back();
            }
          }}
        >
          Exit
        </button>
      </header>
      <nav className="quiz-question-nav" aria-label="Jump to question">
        {questions.map((item, questionIndex) => (
          <button
            type="button"
            key={item.id}
            className={`${questionIndex === index ? "current" : ""} ${answers[item.id] !== undefined ? "answered" : ""}`}
            aria-label={`Question ${questionIndex + 1}${answers[item.id] !== undefined ? ", answered" : ", unanswered"}`}
            aria-current={questionIndex === index ? "step" : undefined}
            onClick={() => setIndex(questionIndex)}
          >
            {questionIndex + 1}
          </button>
        ))}
      </nav>
      <main className="question-wrap">
        <span className="badge badge-purple">{question.position}</span>
        <h1>{question.prompt}</h1>
        <div className="answer-list">
          {options.map((option, choice) => (
            <button
              type="button"
              key={`${question.id}-${choice}`}
              className={answers[question.id] === choice ? "selected" : ""}
              aria-pressed={answers[question.id] === choice}
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
            <Button onClick={() => setIndex(index + 1)}>Next</Button>
          ) : (
            <Button disabled={answered !== questions.length || busy} onClick={onSubmit}>
              {busy ? "Saving…" : "Submit answers"}
            </Button>
          )}
        </div>
      </footer>
      {answered < questions.length && (
        <p className="quiz-unanswered-note" role="status">
          {questions.length - answered}{" "}
          {questions.length - answered === 1 ? "question" : "questions"} left unanswered.
        </p>
      )}
    </div>
  );
}

function ResultsPage({
  attempt,
  paper,
  review,
  reviewLoading,
  reviewError,
  onRetry,
  onBrowse,
  onHistory,
  onAmbassador,
}: {
  attempt: QuizAttempt;
  paper?: Paper;
  review: QuizAttemptReviewItem[];
  reviewLoading: boolean;
  reviewError: string | null;
  onRetry: () => void;
  onBrowse: () => void;
  onHistory: () => void;
  onAmbassador: () => void;
}) {
  const nextStep =
    attempt.score_percent >= 80
      ? "Great accuracy. Try another quiz in this course to check that you can repeat the result."
      : attempt.score_percent >= 60
        ? "Good foundation. Review the questions below, then retry to improve your score."
        : "Take it one question at a time. Review the answers below, then practise this quiz again.";
  const improvement =
    attempt.previous_score_percent === undefined
      ? null
      : attempt.score_percent - attempt.previous_score_percent;

  return (
    <>
      <div className={`result-hero ${attempt.score_percent === 100 ? "perfect-score" : ""}`}>
        {attempt.score_percent === 100 && (
          <div className="score-celebration" aria-hidden="true">
            <span>✦</span>
            <span>✧</span>
            <span>✦</span>
            <span>✧</span>
          </div>
        )}
        <span className="result-complete-mark" aria-hidden="true">
          ✓
        </span>
        <span className="badge badge-green">
          {attempt.score_percent === 100 ? "Perfect score · Quiz saved" : "Quiz saved"}
        </span>
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
          <div className="xp-pill">
            {attempt.points_earned} points earned · 10 per correct answer
          </div>
        )}
        {improvement !== null && (
          <p className="score-comparison" role="status">
            {improvement > 0
              ? `You beat your last score by ${improvement} percentage points.`
              : improvement === 0
                ? "You matched your last score. Keep building on it."
                : `Your last score was ${attempt.previous_score_percent}%. Keep practising to turn missed questions into progress.`}
          </p>
        )}
      </div>
      <div className="result-actions">
        <Button onClick={onRetry}>Retry this quiz</Button>
        <Button variant="secondary" onClick={onBrowse}>
          Choose another quiz
        </Button>
        <Button variant="secondary" onClick={onHistory}>
          View quiz history
        </Button>
      </div>
      <section className="quiz-next-step">
        <span className="eyebrow">Your next step</span>
        <p>{nextStep}</p>
      </section>
      <section className="quiz-ambassador-prompt">
        <div>
          <span className="eyebrow">Help your course mates</span>
          <h2>Earn ₦250 when a new student completes their first quiz.</h2>
        </div>
        <Button variant="secondary" onClick={onAmbassador}>
          Explore the Ambassador Program
        </Button>
      </section>
      <section className="quiz-review">
        <div className="section-title">
          <div>
            <span>Learn from every attempt</span>
            <h2>Answer review</h2>
          </div>
        </div>
        {reviewLoading ? (
          <p className="field-note" role="status">
            Loading your answer review…
          </p>
        ) : reviewError ? (
          <p className="app-feedback" role="alert">
            Answer review is unavailable: {reviewError}
          </p>
        ) : review.length ? (
          <div className="quiz-review-list">
            {review.map((item) => {
              const isCorrect = item.selected_index === item.correct_index;
              return (
                <article
                  className={`quiz-review-item ${isCorrect ? "correct" : "incorrect"}`}
                  key={item.id}
                >
                  <div className="quiz-review-heading">
                    <span>Question {item.position}</span>
                    <strong>{isCorrect ? "Correct" : "Review this one"}</strong>
                  </div>
                  <h3>{item.prompt}</h3>
                  <p>
                    Your answer:{" "}
                    <strong>{item.options[item.selected_index] ?? "Not answered"}</strong>
                  </p>
                  {!isCorrect && (
                    <p>
                      Correct answer: <strong>{item.options[item.correct_index]}</strong>
                    </p>
                  )}
                  <ol className="quiz-review-options">
                    {item.options.map((option, optionIndex) => (
                      <li
                        key={`${item.id}-${optionIndex}`}
                        className={[
                          optionIndex === item.correct_index ? "correct-option" : "",
                          optionIndex === item.selected_index && !isCorrect ? "selected-wrong" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span>{String.fromCharCode(65 + optionIndex)}</span>
                        <span>{option}</span>
                        {optionIndex === item.correct_index && <strong>Correct</strong>}
                        {optionIndex === item.selected_index && <small>Your answer</small>}
                      </li>
                    ))}
                  </ol>
                  {item.explanation && <small>{item.explanation}</small>}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="field-note">No answer review is available for this attempt.</p>
        )}
      </section>
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
        <strong>
          {leader.full_name || "Student"}
          {isMe && rank <= 10 && <em>Top 10</em>}
          {leader.is_pro && <em className="pro-flair">Pro</em>}
        </strong>
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

function GameProgressPanel({
  progress,
  loading,
  error,
  isPro,
}: {
  progress: GameProgress | null;
  loading: boolean;
  error: string | null;
  isPro: boolean;
}) {
  const badgeDefinitions = [
    { id: "first_win", name: "First Victory", description: "Win your first battle", icon: "⚔" },
    {
      id: "perfect_score",
      name: "Perfect Score",
      description: "Answer every quiz question correctly",
      icon: "✓",
    },
    {
      id: "speed_demon",
      name: "Speed Demon",
      description: "Perfect score at 10 seconds per question or faster",
      icon: "↯",
    },
    { id: "daily_3", name: "3-day Starter", description: "Practice 3 days in a row", icon: "✦" },
    { id: "daily_7", name: "7-day Scholar", description: "Practice 7 days in a row", icon: "🔥" },
    {
      id: "daily_14",
      name: "14-day Achiever",
      description: "Practice 14 days in a row",
      icon: "◆",
    },
    { id: "daily_30", name: "30-day Scholar", description: "Practice 30 days in a row", icon: "★" },
  ] as const;
  const earnedBadgeIds = new Set(progress?.badges.map((badge) => badge.badge_id) ?? []);

  return (
    <section className="game-progress-panel">
      <div className="section-title">
        <div>
          <span>Your progress</span>
          <h2>{loading ? "Loading rewards…" : (progress?.title ?? "Game progress")}</h2>
        </div>
        {progress && (
          <span className="badge badge-purple">{progress.points.toLocaleString()} pts</span>
        )}
        {isPro && <span className="badge badge-purple pro-flair">PRO SCHOLAR</span>}
      </div>
      {error ? (
        <p className="app-feedback" role="alert">
          Game progress could not load: {error}
        </p>
      ) : loading ? (
        <p className="field-note" role="status">
          Loading your streaks and badges…
        </p>
      ) : progress ? (
        <>
          <div className="game-progress-stats">
            <div>
              <strong>{progress.current_daily_streak} days</strong>
              <small>Daily streak · best {progress.best_daily_streak} days</small>
            </div>
            <div>
              <strong>{progress.current_win_streak}</strong>
              <small>Battle win streak</small>
            </div>
            <div>
              <strong>{progress.battle_wins}</strong>
              <small>Battle wins</small>
            </div>
            <div>
              <strong>{progress.quizzes_completed}</strong>
              <small>Quizzes completed</small>
            </div>
          </div>
          <TitleProgress progress={progress} />
          <div className="game-badge-list" aria-label="Badges">
            {badgeDefinitions.map((badge) => {
              const milestoneDays = badge.id.startsWith("daily_")
                ? Number(badge.id.slice("daily_".length))
                : null;
              const isEarned =
                earnedBadgeIds.has(badge.id) ||
                (milestoneDays !== null && progress.best_daily_streak >= milestoneDays);
              const earnedAt = progress?.badges.find(
                (item) => item.badge_id === badge.id,
              )?.earned_at;
              return (
                <article className={isEarned ? "earned" : "locked"} key={badge.id}>
                  <span aria-hidden="true">{badge.icon}</span>
                  <div>
                    <strong>{badge.name}</strong>
                    <small>
                      {isEarned && earnedAt
                        ? `Earned ${new Date(earnedAt).toLocaleDateString()}`
                        : isEarned
                          ? "Unlocked with your best daily streak"
                          : badge.description}
                    </small>
                  </div>
                  {isEarned && <b aria-label="Earned">✓</b>}
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

function TitleProgress({ progress }: { progress: GameProgress }) {
  const milestones = [
    { title: "Contender", wins: 1 },
    { title: "Elite", wins: 3 },
    { title: "Grandmaster", wins: 5 },
    { title: "Campus Legend", wins: 10 },
  ];
  const nextMilestone = milestones.find((milestone) => progress.best_win_streak < milestone.wins);
  const progressPercent = nextMilestone
    ? Math.min(100, (progress.best_win_streak / nextMilestone.wins) * 100)
    : 100;

  return (
    <div className="title-progress">
      <div>
        <strong>
          {nextMilestone ? `Next title: ${nextMilestone.title}` : "Top title unlocked"}
        </strong>
        <span>
          {nextMilestone
            ? `${Math.max(0, nextMilestone.wins - progress.best_win_streak)} more best-streak ${
                nextMilestone.wins - progress.best_win_streak === 1 ? "win" : "wins"
              } needed`
            : "You’ve reached Campus Legend"}
        </span>
      </div>
      <div
        className="title-progress-track"
        role="progressbar"
        aria-label={nextMilestone ? `Progress to ${nextMilestone.title}` : "Title ladder complete"}
        aria-valuemin={0}
        aria-valuemax={nextMilestone?.wins ?? 10}
        aria-valuenow={Math.min(progress.best_win_streak, nextMilestone?.wins ?? 10)}
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <small>Titles are earned by setting a new best consecutive battle-win streak.</small>
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
