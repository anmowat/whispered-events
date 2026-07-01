create table love_entries (
  id uuid primary key default gen_random_uuid(),
  author text not null,
  role text not null default '',
  image_url text not null default '',
  linkedin_url text not null default '',
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('love-images', 'love-images', true)
on conflict (id) do nothing;

create policy love_images_public_read
  on storage.objects for select to public
  using (bucket_id = 'love-images');

insert into love_entries (author, role, image_url, linkedin_url, sort_order) values
  ('Dan Ahmadi',          'Building Upside (the data layer for agentic GTM)', '/love/dan-ahmadi.png',          'https://www.linkedin.com/posts/dahmadi_whispered-events-activity-7473518191915335680-hg5Q',                                        1),
  ('Melissa Moody',       'Founder @ Wednesday Women',                        '/love/melissa-moody.png',       'https://www.linkedin.com/posts/melissammoody_in-person-events-are-so-hot-right-now-activity-7472416088685801472-W4X3',          2),
  ('Kathleen Booth',      'VP Marketing @ Sequel.io',                         '/love/kathleen-booth.png',      'https://www.linkedin.com/posts/kathleenslatterybooth_marketing-executiveevents-kathleenhq-activity-7476239553054461952-7GDO', 3),
  ('Nick Zeckets',        'Founder @ Smoke Signals AI',                       '/love/nick zeckets.png',        'https://www.linkedin.com/posts/nzeckets_whispered-events-activity-7476750915476054017-RV4a',                                4),
  ('Chris Schwass',       'GTM Operations and Strategy',                      '/love/chris-schwass.png',       'https://www.linkedin.com/posts/chrisschwass_i-want-to-attend-live-events-but-its-hard-share-7477568588988444673-Ymn0/',       5),
  ('Mollie Bodensteiner', 'RevOps Leader',                                    '/love/mollie-bodensteiner.png', 'https://www.linkedin.com/posts/molliebodensteiner_whispered-events-share-7477690356273168385-xFgS/',                         6);
