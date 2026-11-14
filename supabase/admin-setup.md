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
   quizzes; add course-department discovery labels; and preserve the current published
   quiz while a revised copy goes through separate review. Attempts and battles remain
   attached to their original version. The app changes are prepared in the repository,
   but both migrations must be applied before the live database supports these changes.
6. Run `maintenance-mode.sql` to enable the scheduled maintenance page and
   database access gate.
7. Deploy the two Supabase Edge Functions from the repository root:

   ```sh
   supabase functions deploy admin-invite --project-ref YOUR_PROJECT_REF
   supabase functions deploy admin-student-access --project-ref YOUR_PROJECT_REF
   ```

8. Configure the remaining function secrets in Supabase. Use the exact deployed
   app origin for `APP_URL` and keep the service-role key only in Edge Function
   secrets:

   ```sh
   supabase secrets set --project-ref YOUR_PROJECT_REF \\
     APP_URL="https://your-app.example" \\
     SUPABASE_ANON_KEY="YOUR_PUBLIC_ANON_KEY" \\
     SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
   ```

9. Set `GROQ_API_KEY` as an unprefixed Vercel project environment variable for
   Development, Preview, and Production. The Vercel `/api/extract-quiz-questions`
   function reads it server-side. Optionally set `GROQ_MODEL`; it defaults to
   `qwen/qwen3.8-27b`.

10. Add the same app URL to Supabase Auth's allowed redirect URLs. Invitations
   redirect to `APP_URL/#/admin`.
11. Keep the existing Super Admin membership assigned explicitly to a trusted
   user. Do not assign privileged roles from client-side profile metadata.

The workspace provides the overview, contribution queue, direct paper upload,
student search and suspend/restore controls, team invitations and access
management, university directory creation, audit-log views, and Super Admin-only
scheduled maintenance controls. While maintenance is active, only active
Super Admins can use the full website. Everyone else sees the countdown page;
the database applies the same Super Admin exception to app data access. Team invites activate only after the invited user signs in with the invited, verified email.

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
retry later. Extraction only creates editable pending suggestions. A different
authorized reviewer must inspect the original document, edit questions as needed,
and approve individual questions before approved items can appear in quizzes or
battles. Missing/uncertain answer keys are left unset for a moderator to resolve.

After publication, the quiz creator can start a revision, add or remove questions,
and update its metadata. The current version remains available until a different
authorized reviewer approves the revision; publishing the revision archives the
prior version without deleting its attempts or battle history.

The original PDF/image remains stored as the source of truth and is displayed in
the in-app viewer with a light account watermark and no download control. This
deters casual downloads but cannot prevent screenshots or extraction by a
determined user. Battles use the same approved questions for both players; the
server scores correct answers first and server-recorded sub-second elapsed time
for ties. Each correct answer awards 10 points; battle wins award 4 points, while
draws and losses award 1 point. Wins build streaks and leaderboard titles.

The browser uses only the anon key. The service-role key is required solely by
the Edge Functions and must never be added to `.env` variables prefixed with
`VITE_`.
