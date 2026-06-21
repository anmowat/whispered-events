-- Phase 2 polish: persist event image bytes in Supabase Storage.
--
-- Until now, event images lived only in Airtable's Image attachment field.
-- Airtable's signed URLs expire after ~2h, so /api/event-image/[id] had to
-- re-fetch from Airtable on every cache miss. This migration creates the
-- public bucket the sync layer will upload to so the proxy can 302-redirect
-- instead of round-tripping bytes.
--
-- Object key shape: {event_id}.jpg (single canonical thumbnail per event).

insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;

-- Public read policy. Service-role writes bypass RLS, so no insert/update
-- policy is required here.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'event_images_public_read'
  ) then
    create policy event_images_public_read
      on storage.objects for select
      to public
      using (bucket_id = 'event-images');
  end if;
end $$;
