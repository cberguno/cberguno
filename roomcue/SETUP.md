# QuietCue cloud sync setup (Supabase)

1. Create a free project at https://supabase.com (Dashboard -> New project).
2. In the project, open **SQL Editor -> New query**, paste the contents of `supabase.sql`, and click **Run**.
3. Open **Authentication -> Providers -> Email**. For quickest setup turn **Confirm email** off
   (otherwise new accounts must click an emailed link before signing in).
4. Open **Project Settings -> API** and copy the **Project URL** and the **anon public** key.
5. In `index.html`, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to those two values and redeploy.
   (The anon key is designed to be public; row-level security in `supabase.sql` keeps each
   account's data private. Never use the `service_role` key here.)

Notes
- Sync copies the whole roster and log as one record per account and keeps the newest copy
  (checked every 15 seconds and when the app regains focus). Editing on two devices at the
  same moment can drop the older device's latest changes.
- Without the two values set, the app works exactly as before, storing data only in the browser.
