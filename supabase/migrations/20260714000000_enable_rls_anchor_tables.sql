-- Enable RLS on tables created via standalone script (anchor_events, offers, etc.)
-- and re-run a catch-all loop so any future tables added outside migrations are covered.

alter table if exists public.anchor_events        enable row level security;
alter table if exists public.anchor_event_events  enable row level security;
alter table if exists public.offers               enable row level security;
alter table if exists public.anchor_event_offers  enable row level security;

-- Catch-all: enable RLS on every remaining table in the public schema
do $$
declare
  rec record;
begin
  for rec in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and rowsecurity = false
  loop
    execute format('alter table public.%I enable row level security', rec.tablename);
  end loop;
end;
$$;
