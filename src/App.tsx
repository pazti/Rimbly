import { FormEvent, useEffect, useState } from "react";
import { OfflinePage } from "./components/OfflinePage";
import { getSubmissionErrorMessage } from "./lib/submission";
import { getTableCount, insertSubmission, supabase } from "./lib/supabase";

const universities = [
  "Abia State University (ABSU)",
  "Adamawa State University, Mubi (ADSU)",
  "Adekunle Ajasin University, Akungba (AAUA)",
  "Afe Babalola University, Ado-Ekiti (ABUAD)",
  "Ahmadu Bello University (ABU)",
  "Ajayi Crowther University",
  "Akwa Ibom State University (AKSU)",
  "Al-Hikmah University",
  "Alvan Ikoku University of Education",
  "Ambrose Alli University (AAU)",
  "American University of Nigeria (AUN)",
  "Augustine University, Ilara-Epe",
  "Babcock University",
  "Bauchi State University, Gadau (BASUG)",
  "Bayelsa Medical University",
  "Bayero University, Kano (BUK)",
  "Bells University of Technology",
  "Benue State University (BSU)",
  "Benson Idahosa University",
  "Bingham University",
  "Bowen University",
  "Caleb University",
  "Covenant University",
  "Crawford University",
  "Chrisland University",
  "Chukwuemeka Odumegwu Ojukwu University (COOU)",
  "Delta State University (DELSU)",
  "Dominican University, Ibadan",
  "Edo State University, Uzairue (EDSU)",
  "Ekiti State University (EKSU)",
  "Elizade University",
  "Enugu State University of Science and Technology (ESUT)",
  "Federal University, Birnin Kebbi (FUBK)",
  "Federal University, Dutse (FUD)",
  "Federal University, Dutsin-Ma (FUDMA)",
  "Federal University, Gashua (FUGASHUA)",
  "Federal University, Gusau (FUGUS)",
  "Federal University, Kashere (FUK)",
  "Federal University, Lafia (FULAFIA)",
  "Federal University, Lokoja (FULOKOJA)",
  "Federal University, Ndufu-Alike (FUNAI)",
  "Federal University, Otuoke (FUOTUOKE)",
  "Federal University, Oye-Ekiti (FUOYE)",
  "Federal University, Wukari (FUWUKARI)",
  "Federal University of Agriculture, Abeokuta (FUNAAB)",
  "Federal University of Agriculture, Makurdi (FUAM)",
  "Federal University of Allied Health Sciences, Enugu",
  "Federal University of Health Sciences, Azare (FUHSA)",
  "Federal University of Health Sciences, Ila Orangun",
  "Federal University of Health Sciences, Otukpo (FUHSO)",
  "Federal University of Health Sciences, Tsafe",
  "Federal University of Petroleum Resources, Effurun (FUPRE)",
  "Federal University of Technology, Akure (FUTA)",
  "Federal University of Technology, Babura",
  "Federal University of Technology, Minna (FUTMINNA)",
  "Federal University of Technology, Owerri (FUTO)",
  "Federal University of Transportation, Daura",
  "Fountain University",
  "Gombe State University (GSU)",
  "Godfrey Okoye University",
  "Gregory University, Uturu",
  "Igbinedion University",
  "Imo State University (IMSU)",
  "Joseph Ayo Babalola University",
  "Kaduna State University (KASU)",
  "Kano State University of Science and Technology (KUST)",
  "Kebbi State University of Science and Technology (KSUSTA)",
  "Kings University",
  "Kogi State University (KSU)",
  "Kwara State University (KWASU)",
  "Kwararafa University",
  "Ladoke Akintola University of Technology (LAUTECH)",
  "Lagos State University (LASU)",
  "Landmark University",
  "Lead City University",
  "Madonna University",
  "McPherson University",
  "Michael Okpara University of Agriculture, Umudike (MOUAU)",
  "Modibbo Adama University, Yola (MAU)",
  "Mountain Top University",
  "Nasarawa State University (NSUK)",
  "National Open University of Nigeria (NOUN)",
  "Niger Delta University (NDU)",
  "Nigerian Army University, Biu",
  "Nigeria Police Academy, Wudil",
  "Nile University of Nigeria",
  "Nnamdi Azikiwe University, Awka (UNIZIK)",
  "Novena University",
  "Obafemi Awolowo University (OAU)",
  "Oduduwa University",
  "Pan-Atlantic University",
  "Plateau State University (PLASU)",
  "Redeemer's University",
  "Renaissance University",
  "Ritman University",
  "Rivers State University (RSU)",
  "Salem University",
  "Samuel Adegboyega University",
  "Skyline University Nigeria",
  "Sokoto State University (SSU)",
  "Southwestern University, Oku Owa",
  "Sule Lamido University, Kafin Hausa (SLU)",
  "Taraba State University (TSU)",
  "University of Africa, Toru-Orua (UAT)",
  "University of Abuja (UNIABUJA)",
  "University of Benin (UNIBEN)",
  "University of Calabar (UNICAL)",
  "University of Ibadan (UI)",
  "University of Ilorin (UNILORIN)",
  "University of Jos (UNIJOS)",
  "University of Lagos (UNILAG)",
  "University of Maiduguri (UNIMAID)",
  "University of Medical Sciences, Ondo",
  "University of Mkar",
  "University of Nigeria, Nsukka (UNN)",
  "University of Port Harcourt (UNIPORT)",
  "University of Uyo (UNIUYO)",
  "Usmanu Danfodiyo University, Sokoto (UDUS)",
  "Veritas University",
  "Wellspring University",
  "Western Delta University",
  "Yobe State University (YSU)",
  "Zamfara State University (ZSU)",
  "Others",
];

const levels = ["100 Level", "200 Level", "300 Level", "400 Level", "500 Level", "Postgraduate"];

const subjects = [
  "Mathematics",
  "Anatomy",
  "Accounting",
  "Economics",
  "Engineering",
  "Computer Science",
  "Law",
  "Biochemistry",
];

function BrandMark() {
  return (
    <a className="brand" href="#/" aria-label="Rimbly home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" role="img" aria-hidden="true">
          <path d="M15 9h10.5C31.3 9 37 14 37 21.1c0 5.6-3.8 10.3-9.1 11.2L38 39h-8.9l-7.5-8.3h-2.6V39h-8V9Zm8 8v7.2h1.7c3.4 0 5.4-1.9 5.4-3.7 0-2-2-3.5-5.4-3.5H23Z" />
        </svg>
      </span>
      <span>Rimbly</span>
    </a>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28">
      <path d="M14 2.8 16.4 11l8.1 2.9-8.1 2.7-2.4 8.6-2.5-8.6-8-2.7 8-2.9L14 2.8Z" />
    </svg>
  );
}

type Page = "home" | "suggestions" | "contribute" | "offline";

function pageFromHash(): Page {
  if (window.location.hash === "#/suggestions") return "suggestions";
  if (window.location.hash === "#/contribute") return "contribute";
  if (window.location.hash === "#/offline") return "offline";
  return "home";
}

function FeedbackPage({ kind }: { kind: Exclude<Page, "home"> }) {
  const [sent, setSent] = useState(false);
  const [category, setCategory] = useState("Product idea");
  const [fileName, setFileName] = useState("");
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const isSuggestion = kind === "suggestions";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const payload = isSuggestion
      ? {
          name: (formData.get("name") ?? "").toString(),
          email: (formData.get("email") ?? "").toString(),
          category: (formData.get("category") ?? category).toString(),
          suggestion: (formData.get("suggestion") ?? "").toString(),
        }
      : {
          name: (formData.get("name") ?? "").toString(),
          email: (formData.get("email") ?? "").toString(),
          university: (formData.get("university") ?? "").toString(),
          course_code: (formData.get("courseCode") ?? "").toString(),
          course_title: (formData.get("courseTitle") ?? "").toString(),
          exam_year: Number(formData.get("examYear") ?? 0),
          question_file_name: fileName || "",
          notes: (formData.get("note") ?? "").toString(),
        };

    const table = isSuggestion ? "suggestions" : "contributions";
    const result = await insertSubmission(table, payload);
    const message = getSubmissionErrorMessage(table, result.error);

    if (message) {
      setSubmitMessage(message);
      return;
    }

    setSubmitMessage(null);
    setSent(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="inner-page">
      <section className="inner-page-intro">
        <a className="back-link" href="#/">
          <span aria-hidden="true">←</span> Back to waitlist
        </a>
        <p className="eyebrow">{isSuggestion ? "Help shape Rimbly" : "Grow the archive"}</p>
        <h1>
          {isSuggestion ? (
            <>
              Got an idea?
              <span>We’re listening.</span>
            </>
          ) : (
            <>
              Your questions.
              <span>Everyone’s edge.</span>
            </>
          )}
        </h1>
        <p className="inner-page-copy">
          {isSuggestion
            ? "Tell us what would make practice and Battle League work better for you and your coursemates."
            : "Help students practise smarter by contributing past questions from your university. Clear scans and photos are welcome."}
        </p>
        <aside className="page-tip">
          <SparkIcon />
          <p>
            <strong>
              {isSuggestion ? "Student-led from day one" : "Every useful question counts"}
            </strong>
            {isSuggestion
              ? "We review every note and use them to prioritise what we build."
              : "Our team reviews submissions before they enter the archive."}
          </p>
        </aside>
      </section>

      <section className="inner-form-wrap">
        <div className="form-card inner-form-card">
          {sent ? (
            <div className="success-state inner-success" role="status">
              <div className="success-mark" aria-hidden="true">
                <svg viewBox="0 0 32 32">
                  <path d="m8 16 5 5L24 10" />
                </svg>
              </div>
              <p className="eyebrow">Received</p>
              <h2>{isSuggestion ? "That’s a solid shout." : "Contribution received."}</h2>
              <p>
                {isSuggestion
                  ? "Thanks for helping us build a better Rimbly for university students."
                  : "Thanks for helping the archive grow. We’ll review the questions before publishing."}
              </p>
              <button className="text-button" type="button" onClick={() => setSent(false)}>
                {isSuggestion ? "Send another idea" : "Contribute more questions"}
              </button>
              <a className="success-home-link" href="#/">
                Return to waitlist
              </a>
            </div>
          ) : (
            <>
              <div className="form-heading">
                <p className="eyebrow">
                  {isSuggestion ? "Your perspective matters" : "Share a paper"}
                </p>
                <h2>{isSuggestion ? "Send a suggestion." : "Contribute questions."}</h2>
                <p>
                  {isSuggestion
                    ? "Be honest and specific—we can take it."
                    : "Add the details you know. We’ll handle the rest."}
                </p>
              </div>

              {submitMessage ? (
                <div className="success-state inner-success" role="alert" style={{ marginBottom: "1rem" }}>
                  <p className="eyebrow">Notice</p>
                  <h2>{submitMessage.includes("already") || submitMessage.includes("already been") ? "Duplicate" : "Update"}</h2>
                  <p>{submitMessage}</p>
                </div>
              ) : null}

              <form onSubmit={submit}>
                <div className="form-row">
                  <label>
                    <span>Full Name</span>
                    <input name="name" placeholder="e.g. Dami Adebayo" required />
                  </label>
                  <label>
                    <span>Email Address</span>
                    <input name="email" type="email" placeholder="dami@school.edu.ng" required />
                  </label>
                </div>

                {isSuggestion ? (
                  <>
                    <fieldset>
                      <legend>What is this about?</legend>
                      <div className="chip-list">
                        {["Product idea", "Battle League", "Past questions", "Something else"].map(
                          (item) => (
                            <button
                              key={item}
                              className={category === item ? "chip selected" : "chip"}
                              type="button"
                              aria-pressed={category === item}
                              onClick={() => setCategory(item)}
                            >
                              {item}
                            </button>
                          ),
                        )}
                      </div>
                      <input name="category" type="hidden" value={category} />
                    </fieldset>
                    <label>
                      <span>Your Suggestion</span>
                      <textarea
                        name="suggestion"
                        placeholder="What should we build, improve or rethink?"
                        required
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <div className="form-row">
                      <label>
                        <span>University</span>
                        <select name="university" defaultValue="" required>
                          <option value="" disabled>
                            Select university
                          </option>
                          {universities.map((university) => (
                            <option key={university}>{university}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Course Code</span>
                        <input name="courseCode" placeholder="e.g. MTH 201" required />
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        <span>Course Title</span>
                        <input name="courseTitle" placeholder="e.g. Linear Algebra" required />
                      </label>
                      <label>
                        <span>Exam Year</span>
                        <input
                          name="examYear"
                          type="number"
                          min="1990"
                          max="2026"
                          placeholder="e.g. 2024"
                          required
                        />
                      </label>
                    </div>
                    <fieldset>
                      <legend>Question file</legend>
                      <label className={fileName ? "upload-box has-file" : "upload-box"}>
                        <input
                          name="questions"
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
                          required
                        />
                        <span className="upload-plus" aria-hidden="true">
                          {fileName ? "✓" : "+"}
                        </span>
                        <span>
                          <strong>{fileName || "Choose a PDF or image"}</strong>
                          <small>
                            {fileName ? "Ready to submit" : "PDF, JPG or PNG · Max 10MB"}
                          </small>
                        </span>
                      </label>
                    </fieldset>
                    <label>
                      <span>
                        Anything we should know? <small>(Optional)</small>
                      </span>
                      <textarea
                        name="note"
                        placeholder="Add the semester, lecturer, or any helpful context."
                      />
                    </label>
                  </>
                )}

                <button className="primary-button submit-button" type="submit">
                  {isSuggestion ? "Send Suggestion" : "Submit Questions"}
                  <ArrowIcon />
                </button>
                <p className="privacy-note">
                  {isSuggestion
                    ? "Your feedback is only used to improve Rimbly."
                    : "Only reviewed, relevant academic material will be published."}
                </p>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [count, setCount] = useState(1240);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [customSubject, setCustomSubject] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  useEffect(() => {
    const onHashChange = () => {
      setPage(pageFromHash());
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    window.addEventListener("hashchange", onHashChange);

    let frameId: number | undefined;
    const fallbackTarget = 1284;
    const start = performance.now();
    const duration = 1300;

    const tick = (time: number) => {
      const progress = Math.min((time - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount((current) => {
        const currentBase = current && current > 1000 ? current : 1240;
        return Math.round(currentBase + (fallbackTarget - currentBase) * eased);
      });
      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };

    const loadLiveCount = async () => {
      const { count: liveCount } = await getTableCount("waitlist");
      if (typeof liveCount === "number") {
        setCount(liveCount);
        return;
      }

      frameId = requestAnimationFrame(tick);
    };

    void loadLiveCount();

    if (!supabase) {
      return () => {
        if (frameId) cancelAnimationFrame(frameId);
        window.removeEventListener("hashchange", onHashChange);
      };
    }

    const channel = supabase.channel("waitlist-count");
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "waitlist" },
      () => {
        setCount((current) => current + 1);
      },
    );
    void channel.subscribe();

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      supabase.removeChannel(channel);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const toggleSubject = (subject: string) => {
    setSelectedSubjects((current) =>
      current.includes(subject)
        ? current.filter((item) => item !== subject)
        : [...current, subject],
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const payload = {
      name: (formData.get("name") ?? "").toString(),
      email: (formData.get("email") ?? "").toString(),
      phone: (formData.get("phone") ?? "").toString(),
      university: (formData.get("university") ?? "").toString(),
      level: (formData.get("level") ?? "").toString(),
      subjects: selectedSubjects.join(", "),
    };

    const result = await insertSubmission("waitlist", payload);
    const message = getSubmissionErrorMessage("waitlist", result.error);

    if (message) {
      setFormMessage(message);
      return;
    }

    setFormMessage(null);
    setSubmitted(true);
    setCount((current) => current + 1);
  };

  const addCustomSubject = () => {
    const subject = customSubject.trim();
    if (!subject) return;
    setSelectedSubjects((current) =>
      current.some((item) => item.toLowerCase() === subject.toLowerCase())
        ? current
        : [...current, subject],
    );
    setCustomSubject("");
  };

  const scrollToForm = () => {
    document.querySelector("#waitlist")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    const updateNetworkState = () => {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (offline && window.location.hash !== "#/offline") {
        window.location.hash = "#/offline";
      }
      if (!offline && window.location.hash === "#/offline") {
        window.location.hash = "#/";
      }
    };

    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    updateNetworkState();

    return () => {
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  if (page === "offline") {
    return <OfflinePage />;
  }

  return (
    <div id="top" className="site-shell">
      <header className="topbar">
        <nav className="nav-inner" aria-label="Primary navigation">
          <BrandMark />
          <div className="nav-links">
            <a className={page === "suggestions" ? "active" : ""} href="#/suggestions">
              Suggestions
            </a>
            <span aria-hidden="true" />
            <a className={page === "contribute" ? "active" : ""} href="#/contribute">
              Contribute
            </a>
          </div>
        </nav>
      </header>

      {page === "home" ? (
        <main>
          <div className="page-grid">
            <section className="hero" aria-labelledby="hero-title">
              <div className="hero-decoration hero-decoration-one" aria-hidden="true" />
              <div className="hero-decoration hero-decoration-two" aria-hidden="true" />

              <div className="hero-content">
                <div className="coming-soon">
                  <span className="live-dot" aria-hidden="true" />
                  Coming soon
                </div>

                <h1 id="hero-title">
                  Practice. Battle.
                  <span>Climb.</span>
                </h1>

                <p className="hero-copy">
                  Master your university courses with real past questions, then battle students
                  nationwide every evening at 7pm.
                </p>

                <div className="hero-actions">
                  <button
                    className="primary-button hero-button"
                    type="button"
                    onClick={scrollToForm}
                  >
                    Join the Waitlist
                    <ArrowIcon />
                  </button>

                  <div className="counter" aria-live="polite">
                    <span className="counter-avatars" aria-hidden="true">
                      <i>AO</i>
                      <i>TK</i>
                      <i>IN</i>
                    </span>
                    <p>
                      Currently <strong>{count.toLocaleString()}</strong> university students on the
                      waitlist
                    </p>
                  </div>
                </div>

                <aside className="battle-note" aria-label="Battle League schedule">
                  <span className="battle-icon">
                    <SparkIcon />
                  </span>
                  <p>
                    <strong>Battle League</strong>
                    Live every evening · 7:00 PM
                  </p>
                  <span className="live-label">Live</span>
                </aside>
              </div>
            </section>

            <section className="form-section" id="waitlist" aria-labelledby="form-title">
              <div className="form-card">
                {submitted ? (
                  <div className="success-state" role="status">
                    <div className="success-mark" aria-hidden="true">
                      <svg viewBox="0 0 32 32">
                        <path d="m8 16 5 5L24 10" />
                      </svg>
                    </div>
                    <p className="eyebrow">You’re on the list</p>
                    <h2>Welcome to the front row.</h2>
                    <p>
                      We’ll send launch updates and your priority access details straight to your
                      inbox.
                    </p>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setSubmitted(false)}
                    >
                      Add another student
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="form-heading">
                      <p className="eyebrow">Get early access</p>
                      <h2 id="form-title">Save your spot.</h2>
                      <p>Tell us a little about you. It takes less than a minute.</p>
                    </div>

                    {formMessage ? (
                      <div className="success-state" role="alert" style={{ marginBottom: "1rem" }}>
                        <p className="eyebrow">Notice</p>
                        <h2>{formMessage.includes("already") ? "Duplicate" : "Update"}</h2>
                        <p>{formMessage}</p>
                      </div>
                    ) : null}

                    <form onSubmit={handleSubmit}>
                      <div className="form-row">
                        <label>
                          <span>Full Name</span>
                          <input name="name" type="text" placeholder="e.g. Dami Adebayo" required />
                        </label>

                        <label>
                          <span>Email Address</span>
                          <input
                            name="email"
                            type="email"
                            placeholder="dami@school.edu.ng"
                            required
                          />
                        </label>
                      </div>

                      <div className="form-row">
                        <label>
                          <span>WhatsApp Number</span>
                          <div className="phone-field">
                            <span>+234</span>
                            <input
                              name="phone"
                              type="tel"
                              inputMode="tel"
                              placeholder="801 234 5678"
                              aria-label="WhatsApp number"
                              required
                            />
                          </div>
                        </label>

                        <label>
                          <span>University</span>
                          <select name="university" defaultValue="" required>
                            <option value="" disabled>
                              Select your university
                            </option>
                            {universities.map((university) => (
                              <option key={university}>{university}</option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <label>
                        <span>Current Level</span>
                        <select name="level" defaultValue="" required>
                          <option value="" disabled>
                            Select your current level
                          </option>
                          {levels.map((level) => (
                            <option key={level}>{level}</option>
                          ))}
                        </select>
                      </label>

                      <fieldset>
                        <legend>Preferred Subjects / Courses</legend>
                        <p className="field-help">Pick all that apply</p>
                        <div className="chip-list">
                          {[
                            ...subjects,
                            ...selectedSubjects.filter((subject) => !subjects.includes(subject)),
                          ].map((subject) => {
                            const isSelected = selectedSubjects.includes(subject);
                            return (
                              <button
                                key={subject}
                                className={isSelected ? "chip selected" : "chip"}
                                type="button"
                                aria-pressed={isSelected}
                                onClick={() => toggleSubject(subject)}
                              >
                                <span aria-hidden="true">{isSelected ? "✓" : "+"}</span>
                                {subject}
                              </button>
                            );
                          })}
                        </div>
                        <div className="course-adder">
                          <input
                            value={customSubject}
                            onChange={(event) => setCustomSubject(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addCustomSubject();
                              }
                            }}
                            placeholder="Type any other course"
                            aria-label="Add another preferred course"
                          />
                          <button type="button" onClick={addCustomSubject}>
                            Add
                          </button>
                        </div>
                        {selectedSubjects.map((subject) => (
                          <input key={subject} name="subjects" type="hidden" value={subject} />
                        ))}
                      </fieldset>

                      <button className="primary-button submit-button" type="submit">
                        Join Waitlist
                        <ArrowIcon />
                      </button>
                      <p className="privacy-note">
                        No spam, ever. Just launch updates and early-access perks.
                      </p>
                    </form>
                  </>
                )}
              </div>
            </section>
          </div>

          <section className="early-access">
            <span className="mini-spark" aria-hidden="true">
              <SparkIcon />
            </span>
            <p>
              Early members get priority access <span>+</span> exclusive rewards at launch
            </p>
            <div>
              <a href="#/suggestions">Suggestions</a>
              <a href="#/contribute">Contribute Questions</a>
            </div>
          </section>
        </main>
      ) : (
        <FeedbackPage key={page} kind={page} />
      )}

      <footer>
        <BrandMark />
        <p>Rimbly © 2026</p>
        <p className="footer-tagline">Built for Nigerian university students.</p>
      </footer>
    </div>
  );
}
