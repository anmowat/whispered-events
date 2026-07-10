-- Track when a user last engaged via an email link (rating click).
-- Kept separate from sessions.last_seen_at (which is login-based)
-- so the two signals can be merged at read time.

alter table public.users add column if not exists email_last_seen_at timestamptz;
