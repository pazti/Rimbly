# Admin workspace setup

The admin UI is at `/#/admin`. Run the following database setup in order; do not
re-run the core waitlist SQL as a substitute for the Rimbly application schema.

1. Confirm the application tables used by Rimbly exist in the Supabase project.
2. Run `admin-foundation.sql` if the initial RBAC/review migration has not already
   been applied.
3. Run `admin-management.sql`.
4. Run `maintenance-mode.sql` to enable the scheduled maintenance page and
   database access gate.
5. Deploy the two Edge Functions from the repository root:

   ```sh
   supabase functions deploy admin-invite --project-ref YOUR_PROJECT_REF
   supabase functions deploy admin-student-access --project-ref YOUR_PROJECT_REF
   ```

6. Configure function secrets in Supabase. Use the exact deployed app origin for
   `APP_URL` and keep the service-role key only in Edge Function secrets:

   ```sh
   supabase secrets set --project-ref YOUR_PROJECT_REF \
     APP_URL="https://your-app.example" \
     SUPABASE_ANON_KEY="YOUR_PUBLIC_ANON_KEY" \
     SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
   ```

7. Add the same app URL to Supabase Auth's allowed redirect URLs. Invitations
   redirect to `APP_URL/#/admin`.
8. Keep the existing Super Admin membership assigned explicitly to a trusted
   user. Do not assign privileged roles from client-side profile metadata.

The workspace provides the overview, contribution queue, direct paper upload,
student search and suspend/restore controls, team invitations and access
management, university directory creation, audit-log views, and Super Admin-only
scheduled maintenance controls. While maintenance is active, only active
Super Admins can use the full website. Everyone else sees the countdown page;
the database applies the same Super Admin exception to app data access. Team invites
activate only after the invited user signs in with the invited, verified email.

The browser uses only the anon key. The service-role key is required solely by
the Edge Functions and must never be added to `.env` variables prefixed with
`VITE_`.
