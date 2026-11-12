# Admin workspace setup

The admin UI is at `/#/admin`. Run the following database setup in order; do not
re-run the core waitlist SQL as a substitute for the Rimbly application schema.

1. Confirm the application tables used by Rimbly exist in the Supabase project.
2. Run `admin-foundation.sql` if the initial RBAC/review migration has not already
   been applied.
3. Run `admin-management.sql`.
4. Run `quiz-battles.sql` to enable paper-linked question authoring, per-question
   review, quiz attempts,
   one-on-one battles, points, streaks, titles, university leaderboards, and
   case-insensitive course-code uniqueness within each university. If the unique
   index detects existing duplicate course records, merge their linked content
   before retrying the migration.
5. Run `maintenance-mode.sql` to enable the scheduled maintenance page and
   database access gate.
6. Deploy these three Edge Functions from the repository root:

   ```sh
   supabase functions deploy admin-invite --project-ref YOUR_PROJECT_REF
   supabase functions deploy admin-student-access --project-ref YOUR_PROJECT_REF
   supabase functions deploy extract-quiz-questions --project-ref YOUR_PROJECT_REF
   ```

7. Configure function secrets in Supabase. Use the exact deployed app origin for
   `APP_URL` and keep the service-role key only in Edge Function secrets:

   ```sh
   supabase secrets set --project-ref YOUR_PROJECT_REF \
     APP_URL="https://your-app.example" \
     SUPABASE_ANON_KEY="YOUR_PUBLIC_ANON_KEY" \
     SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
      GROQ_API_KEY="YOUR_GROQ_API_KEY"
   ```

   The extraction function defaults to Groq model `qwen/qwen3.8-27b`. Set
   `GROQ_MODEL` if you want to use another Groq vision model that supports
   structured outputs.

8. Add the same app URL to Supabase Auth's allowed redirect URLs. Invitations
   redirect to `APP_URL/#/admin`.
9. Keep the existing Super Admin membership assigned explicitly to a trusted
   user. Do not assign privileged roles from client-side profile metadata.

The workspace provides the overview, contribution queue, direct paper upload,
student search and suspend/restore controls, team invitations and access
management, university directory creation, audit-log views, and Super Admin-only
scheduled maintenance controls. While maintenance is active, only active
Super Admins can use the full website. Everyone else sees the countdown page;
the database applies the same Super Admin exception to app data access. Team invites activate only after the invited user signs in with the invited, verified email.

Student-submitted academic content remains private until an administrator reviews
and approves it. Quiz questions must link to an approved source paper. Manual
entry remains supported. The optional “Extract questions (AI assist)” action sends
rendered page images to Groq using the `GROQ_API_KEY` Edge Function secret. PDF
pages are rendered in the browser, and up to 60 pages are processed in batches
of three to respect Groq vision limits. Extraction only creates editable pending
suggestions. A different authorized reviewer must inspect the original document,
edit questions as needed, and approve individual questions before approved items
can appear in quizzes or battles. Missing/uncertain answer keys are left unset
for a moderator to resolve. Free-tier rate limits can delay or interrupt large
extractions; retry later or enter questions manually.

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
