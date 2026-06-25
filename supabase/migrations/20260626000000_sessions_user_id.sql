-- Sessions are about to switch their join key from `email` to `user_id`
-- (matches.user_email and digest_sends.user_email follow in a later
-- migration once the application stops reading them). Add the column,
-- backfill from the current rows by matching on lowercased email, and
-- index it. `email` stays in place for one deploy cycle so a rollback
-- is possible; a later migration drops it.

alter table sessions add column if not exists user_id text;

update sessions s
   set user_id = u.id
  from users u
 where s.user_id is null
   and lower(s.email) = lower(u.email);

create index if not exists sessions_user_id_idx on sessions (user_id);
