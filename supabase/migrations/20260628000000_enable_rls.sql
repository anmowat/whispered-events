-- Enable Row-Level Security on all public tables.
--
-- The app accesses Supabase exclusively via SUPABASE_SERVICE_ROLE_KEY, which
-- bypasses RLS entirely. Enabling RLS here has zero effect on server-side
-- operations but closes the gap where the anon key (embedded in every browser
-- that loads Supabase's JS client) could read, write, or delete rows directly
-- via the REST API.
--
-- No permissive policies are added. With RLS on and no policies, the effective
-- rule for all non-service-role callers is: deny everything (default-deny).

alter table public.events enable row level security;
alter table public.users enable row level security;
alter table public.matches enable row level security;
alter table public.sessions enable row level security;
