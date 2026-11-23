# Admin workspace setup

The admin UI is at `/#/admin`. Run the following database setup in order; do not
re-run the core waitlist SQL as a substitute for the Rimbly application schema.

1. Confirm the application tables used by Rimbly exist in the Supabase project.
2. Run `admin-foundation.sql` if the initial RBAC/review migration has not already
   been applied.
3. Run `admin-management.sql`.
4. Run `quiz-battles.sql` to enable paper-linked question authoring, per-question
   review, quiz attempts, one-on-one battles, points, streaks, titles, university
   leaderboards, and case-insensitive course-code uniqueness within each
   university. If the unique index detects existing duplicate course records,
   merge their linked content before retrying the migration.
5. Apply `quiz-audience-targeting.sql`, then `quiz-revisions.sql`, through the
   project's authorized Supabase migration workflow. These add optional university,
   department, and year-of-study labels without restricting access; allow paperless
   quizzes; add course-department discovery labels; allow creator self-publishing;
   preserve the current published quiz while a revision is edited; and provide a safe
   delete action that archives quizzes without removing attempts or battles. Then apply
   `admin-content-editing.sql`. It adds audited Super Admin editing for past-paper and
   shared course metadata, optional paper-file replacement, quiz revisions across
   creators, editable-draft takeover, and quiz archival across creators. Course metadata
   changes apply to all papers linked to that course. Also apply
   `quiz-random-ten-questions.sql` before `quiz-learning-ux.sql`. These app changes are
   prepared in the repository, but the migrations must be applied before the live
   database supports them.
6. Apply `gamification.sql` after the quiz migrations. Quizzes and battles award 10
   points per correct answer; battles add 25 points for a win or 8 for a draw.
   The migration adds UTC daily streaks, earned badges, and weekly/all-time
   leaderboards. Weekly rankings reset every Monday at 00:00 UTC. The title ladder
   uses best battle streak thresholds of 1, 3, 5, and 10 wins. Apply
   `activation-measurement.sql` after `quiz-battles.sql` and the admin foundation
   and management migrations to measure signup-to-first-reviewed-quiz activation.
   Activation is recorded after the score is saved and its answer review loads. It
   tracks only accounts created after the migration, stores an internal account ID
   and timing but no names or answers, and exposes aggregate metrics to administrators
   with `analytics.view`. Then apply `ambassador-program.sql`. It adds an
   agreement-gated ambassador flow, unique invite codes, signup attribution, ₦250
   rewards after a referred student completes their first reviewed quiz, dashboard
   totals, and Super Admin pause/remove controls. It relies on activation events and
   must be applied after activation measurement is installed. Rerunning this
   migration safely replaces its RPCs and backfills referrals from signup metadata
   for existing accounts that were created after an ambassador agreed to the terms.
   Referral attribution is stored in `ambassador_referrals`, not on `profiles`.
7. Apply `monetization.sql` after `gamification.sql`. It adds server-managed
   Rimbly Pro subscriptions and payment records, a Pro flair on leaderboards,
   five free quiz submissions and three free battle invites per UTC day, and
   usage/status reporting. The limits are enforced in database triggers, not
   only by the UI. Weekly, monthly, and semester payments grant 7 days, 1 month,
   and 4 months respectively; plans do not auto-renew. Then apply
   `quiz-learning-ux.sql` to enable secure, post-submission answer review. The
   Home daily-goal card also reads remaining allowance and today's completed
   practice from the monetization status function.
8. Apply `harden-submission-workflows.sql` after `quiz-learning-ux.sql`.
9. Run `maintenance-mode.sql` to enable the scheduled maintenance page and
   database access gate. Then apply `guest-explore.sql` to expose a bounded,
   read-only course and reviewed-quiz catalog to signed-out visitors. The public
   function does not return source file paths, question contents, or answer keys.
   Apply `open-battle-invites.sql` after `quiz-battles.sql`,
   `monetization.sql`, and `maintenance-mode.sql` to enable shareable university
   battle links and a privacy-preserving recent campus battle feed. Open links
   expire after seven days and can only be accepted by active students at the
   inviter's university; the feed shows only recent quiz titles and dates, never
   player names.
10. Apply `learning-rewards.sql` last, after all other database migrations above.
    It records daily and weekly mission completion, awards 20 XP for the first reviewed
    quiz each UTC day, 50 XP for studying on three days in a UTC week, and 30 XP for a
    weekly battle win. Approved study-resource contributions award 50 XP; an ambassador
    earns 100 XP when a referred student completes their first reviewed quiz. Rewards
    and the First Steps, Comeback, Helpful Contributor, and Campus Connector badges are
    idempotent; current-period mission progress is safely backfilled. A seven-day study
    streak earns a recovery token (maximum two held), which can restore a streak after
    one missed UTC day when the student returns to practice. Earned badges also unlock
    profile frames and themes; users can equip one of each from their profile. Ambassador
    payout accounts and the payout ledger are private: ambassadors manage their own
    bank details, and only Super Admins can view full account details or payout metrics.
    Transfers are manual, with a ₦5,000 minimum per ambassador and payouts recorded on
    Sundays in Africa/Lagos time after the transfer is complete. This migration does
    not initiate bank transfers. It also reconciles referrals with activation events
    already recorded before the ambassador reward trigger was installed.
11. Deploy the two Supabase Edge Functions from the repository root:

   ```sh
   supabase functions deploy admin-invite --project-ref YOUR_PROJECT_REF
   supabase functions deploy admin-student-access --project-ref YOUR_PROJECT_REF
   ```

12. Configure the Supabase Edge Function secrets. Use the exact deployed app
    origin for `APP_URL` and keep these values in Supabase secrets:

```sh
supabase secrets set --project-ref YOUR_PROJECT_REF \
  APP_URL="https://rimbly.vercel.app" \
  SUPABASE_ANON_KEY="YOUR_PUBLIC_ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
```

11. Set `GROQ_API_KEY` as an unprefixed Vercel project environment variable for
    Development, Preview, and Production. The Vercel `/api/extract-quiz-questions`
    function reads it server-side. Optionally set `GROQ_MODEL`; it defaults to
    `qwen/qwen3.8-27b`.

12. Configure the Vercel project environment for Development, Preview, and
    Production. The payment functions read `VITE_SUPABASE_URL` and
    `VITE_SUPABASE_ANON_KEY` as configured for the browser app.
    `SUPABASE_SERVICE_ROLE_KEY` and `SQUADCO_SECRET_KEY` must be unprefixed
    server-only variables and must never use a `VITE_` prefix.
    Start with `SQUADCO_MODE=sandbox`; use `production` only after testing with
    live SquadCo keys. Set `APP_URL` to the exact deployed app origin.

    The hosted checkout endpoint is `/api/squadco/checkout`. Configure that
    same app's SquadCo webhook URL as `/api/squadco/webhook`. The webhook
    validates SquadCo's HMAC-SHA512 signature and then verifies the transaction
    with SquadCo before activating Pro. Checkout stays unavailable until these
    server variables and the migration are in place. Do not send card details
    through Rimbly or treat the browser redirect as proof of payment.
    SquadCo marks its publicly accessible legacy API documentation as
    deprecated; confirm the current endpoint and webhook contract with SquadCo
    before enabling production keys.

13. Add the same app URL to Supabase Auth's allowed redirect URLs. Invitations
    redirect to `APP_URL/#/admin`. To remove the email-confirmation gate, open
    Supabase Dashboard → Authentication → Providers → Email and turn off
    **Confirm email**. The app already continues directly to profile setup when
    Supabase returns a session after signup. This hosted Auth setting cannot be
    changed from the repository; if it stays enabled, signups will still need to
    confirm and can use Guest Explore while waiting.
14. Keep the existing Super Admin membership assigned explicitly to a trusted
    user. Do not assign privileged roles from client-side profile metadata.

The workspace provides the overview, contribution queue, direct paper upload,
student search and suspend/restore controls, team invitations and access
management, university directory creation, audit-log views, and Super Admin-only
scheduled maintenance controls. While maintenance is active, only active
Super Admins can use the full website. Everyone else sees the countdown page;
the database applies the same Super Admin exception to app data access. Team invites activate only after the invited user signs in with the invited, verified email.

Super Admins can edit past-paper metadata and replace its source file from the Past
Questions admin section. Course metadata is shared by all papers for that course;
every paper edit and draft takeover is recorded in the admin audit log. Published
quizzes are edited through a revision so the existing version and its attempts remain
intact until the revision is published. Pending-review quizzes stay in the reviewer
workflow rather than being taken over.

Student-submitted academic content remains private until an administrator reviews
and approves it. A quiz can be created without a source paper; when a paper is
linked, it must be approved. Manual question entry works for both paperless and
paper-backed quizzes. The optional “Extract questions (AI assist)” action is
available only when an approved source paper is linked. It sends rendered page
images to Groq through the Vercel `/api/extract-quiz-questions` function, using the
server-only `GROQ_API_KEY` Vercel variable. PDF pages are rendered in the browser,
and up to 60 pages are processed in payload-sized batches to respect Vercel and
Groq limits. On a short 429 rate limit, the app waits for Groq's `Retry-After`
window and retries that page batch once; longer resets are shown so the admin can
retry later. Extraction and pasted JSON create editable pending suggestions. The
creator can request a different reviewer or self-publish after checking every
question, option, and answer key. Self-publishing requires a correct answer for every
question and is recorded in the audit log. Missing/uncertain answer keys are left
unset until a moderator or quiz creator resolves them.

After publication, the creator can start a revision, add or remove questions, and
update metadata. The current version remains available until the revision is
published. A reviewer can approve it, or the creator can self-publish after checking
the complete set; publishing archives the prior version without deleting attempts
or battle history.

The original PDF/image remains stored as the source of truth and is displayed in
the in-app viewer with a light account watermark and no download control. This
deters casual downloads but cannot prevent screenshots or extraction by a
determined user. Battles use the same approved questions for both players; the
server scores correct answers first and server-recorded elapsed time for ties.
Each correct answer awards 10 points; a win adds 25 points, a draw adds 8, and a
loss adds no bonus points. Wins build streaks and leaderboard titles.

The browser uses only the anon key. The service-role key is required solely by
the Edge Functions and must never be added to `.env` variables prefixed with
`VITE_`.

Ambassador totals count account signups attributed at account creation. A reward is
earned once, after the referred account completes its first reviewed quiz and loads the
answer review. Ambassadors can save their payout account from the ambassador page and
see earned, paid, and available totals. Super Admins can review program-wide metrics,
view account details, and record a completed Sunday transfer with its bank reference.
The payout action only records the external transfer; Rimbly does not initiate or
process bank payments.
