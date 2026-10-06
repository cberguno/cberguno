-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
create table if not exists public.quietcue_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.quietcue_state enable row level security;

-- Each signed-in user can read and write only their own row.
create policy "own row select" on public.quietcue_state
  for select using (auth.uid() = user_id);
create policy "own row insert" on public.quietcue_state
  for insert with check (auth.uid() = user_id);
create policy "own row update" on public.quietcue_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
