-- Enable Row-Level Security on every table in the public schema that does
-- not already have it. Running ALTER TABLE ... ENABLE ROW LEVEL SECURITY on
-- a table that already has RLS on is a no-op, so this is safe to apply even
-- if some tables were covered by the earlier migration.
--
-- The app uses SUPABASE_SERVICE_ROLE_KEY for all DB access (service role
-- bypasses RLS), so enabling RLS has no effect on server-side operations.
-- It closes the anon-key attack surface that Supabase's security advisor flags.

do $$
declare
  tbl record;
begin
  for tbl in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'alter table %I.%I enable row level security',
      tbl.schemaname,
      tbl.tablename
    );
  end loop;
end
$$;
