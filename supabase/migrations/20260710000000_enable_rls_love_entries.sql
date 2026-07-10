-- love_entries was created after the bulk RLS migration so it was missed.
-- The app accesses this table via service role only; enabling RLS with no
-- permissive policies = default-deny for anon/public callers.

alter table public.love_entries enable row level security;
