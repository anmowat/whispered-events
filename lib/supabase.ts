import { createClient } from '@supabase/supabase-js'

// Required Supabase tables:
//
// magic_link_tokens:
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   email text NOT NULL,
//   token text UNIQUE NOT NULL,
//   expires_at timestamptz NOT NULL,
//   used_at timestamptz
//
// sessions:
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   email text NOT NULL,
//   token text UNIQUE NOT NULL,
//   expires_at timestamptz NOT NULL,
//   last_seen_at timestamptz NOT NULL DEFAULT now()
//   (touched by verifySession, throttled to once per 5 min per session)
//
// matches: (existing) — adds notified_at timestamptz, NULL until the (user, event)
//   pair has been included in an emailed digest. Indexed via
//   matches_notified_at_idx (user_id, notified_at).
//
// user_digest_state:
//   user_id text PRIMARY KEY,            -- Airtable User record id
//   next_monthly_digest_at date NOT NULL,
//   last_monthly_digest_sent_at timestamptz NULL
//
// contributions:
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   submitter_email text NOT NULL,
//   event_id text NULL,                  -- Airtable event record id
//   event_name text NULL,
//   airtable_user_id text NULL,          -- backfilled at signup/approval
//   source text NOT NULL,                -- 'form' | 'inbound_email' | 'check_event'
//   submitted_at timestamptz NOT NULL DEFAULT now()
//
// digest_sends:
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   user_id text NOT NULL,                 -- Airtable user record id
//   user_email text NOT NULL,
//   sent_at timestamptz NOT NULL DEFAULT now(),
//   kind text NOT NULL,                    -- 'per_event' | 'cron' | 'welcome'
//   event_ids text[] NOT NULL DEFAULT '{}' -- events actually included
//   Indexed via digest_sends_user_email_sent_at_idx (user_email, sent_at DESC).
//
//   Only written for digest emails that contain >=1 event. Distinct from
//   matches.notified_at, which also gets stamped silently when a user
//   flips Frequency from non-digest to digest (no email goes out).
//
// topics:
//   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//   name text UNIQUE NOT NULL,             -- chip label shown in signup
//   taxonomy text NOT NULL DEFAULT 'Functions',
//                                          -- one of 'Industries' | 'Functions'
//                                          --        | 'Themes' | 'Communities'
//                                          --        (anything else hides the row from the
//                                          --        chip picker but admin can still edit it)
//   sort_order integer NOT NULL DEFAULT 0, -- ascending within taxonomy
//   created_at timestamptz NOT NULL DEFAULT now()
//   Used by the signup chip picker (via the public GET /api/topics
//   endpoint) and by admin via /admin/topics. Admin is the only writer.
//   Migration to add taxonomy column on an existing topics table:
//     ALTER TABLE topics ADD COLUMN IF NOT EXISTS taxonomy text NOT NULL DEFAULT 'Functions';

function getClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function hasBeenNotified(eventId: string, userId: string): Promise<boolean> {
  const supabase = getClient()
  const { data } = await supabase
    .from('matches')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

export interface MatchRow {
  score: number
  inputs_hash: string | null
  match_percent: number | null
  // Null when this user hasn't been told about this event yet via any
  // digest/per-event path. process-matches uses this to decide whether
  // a rescore (e.g. admin-triggered event re-match) should fire a fresh
  // 'As they arrive' digest, or whether the user has already heard.
  notified_at: string | null
}

export async function getExistingMatch(
  eventId: string,
  userId: string,
): Promise<MatchRow | null> {
  const supabase = getClient()
  const { data } = await supabase
    .from('matches')
    .select('score, inputs_hash, match_percent, notified_at')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data as MatchRow | null) ?? null
}

export interface MatchLog {
  eventId: string
  userId: string
  // Required to satisfy the legacy NOT NULL constraint on matches.user_email.
  // Nothing reads this column — all queries join by user_id. A follow-up
  // migration drops the column; until then writers must pass the current
  // email or the upsert fails with a 23502.
  userEmail: string
  score: number
  matchPercent: number
  locationScore: number | null
  audienceScore: number | null
  qualityScore: number | null
  preferenceScore: number | null
  inputsHash: string
  skippedReason?: 'grade_c' | 'location_zero' | 'women_only_audience' | 'seniority_mismatch' | 'employment_mismatch' | 'company_size_mismatch' | null
}

// NOTE: We deliberately do NOT include notified_at in the upsert payload.
// On INSERT, the column's schema default applies (must be NULL — we hit a
// production bug where someone set `default now()` via the Supabase
// dashboard, every new match got auto-stamped, the daily cron found zero
// unnotified rows, and no digests went out for days). On UPDATE (existing
// match rescore), notified_at must be preserved so matches that were
// already emailed don't re-fire. Both invariants depend on notified_at
// NEVER appearing in this payload. If you add a default back to the column
// in Supabase, you re-introduce the bug.
//
// user_email is written purely to satisfy the legacy NOT NULL constraint
// on matches.user_email. Every reader joins by user_id; nothing queries
// this column. A follow-up migration drops it.
export async function logMatch(entry: MatchLog): Promise<void> {
  const supabase = getClient()
  const { error } = await supabase.from('matches').upsert(
    {
      event_id: entry.eventId,
      user_id: entry.userId,
      user_email: entry.userEmail,
      score: entry.score,
      match_percent: entry.matchPercent,
      location_score: entry.locationScore,
      audience_score: entry.audienceScore,
      quality_score: entry.qualityScore,
      preference_score: entry.preferenceScore,
      inputs_hash: entry.inputsHash,
      skipped_reason: entry.skippedReason ?? null,
    },
    { onConflict: 'event_id,user_id' },
  )
  if (error) {
    console.error('logMatch upsert error:', error)
    throw new Error(`logMatch failed: ${error.message}`)
  }
}

const MATCH_PERCENT_THRESHOLD = 40

export async function getMatchedEventIdsForUser(userId: string): Promise<Set<string>> {
  const supabase = getClient()
  const { data } = await supabase
    .from('matches')
    .select('event_id')
    .eq('user_id', userId)
    .gte('match_percent', MATCH_PERCENT_THRESHOLD)
  return new Set((data ?? []).map((m: { event_id: string }) => m.event_id))
}

export type MatchRating = 'going' | 'cant_make_it' | 'not_a_fit'

export interface UserMatchScore {
  score: number
  matchPercent: number
  rating: MatchRating | null
  ratingReason: string | null
  hostRating: 'up' | 'down' | null
}

export async function getMatchScoresForUser(
  userId: string,
): Promise<Map<string, UserMatchScore>> {
  const supabase = getClient()
  const { data } = await supabase
    .from('matches')
    .select('event_id, score, match_percent, rating, rating_reason, host_rating')
    .eq('user_id', userId)
  const scores = new Map<string, UserMatchScore>()
  for (const row of data ?? []) {
    const r = row as {
      event_id: string
      score: number
      match_percent: number | null
      rating: MatchRating | null
      rating_reason: string | null
      host_rating: 'up' | 'down' | null
    }
    const prev = scores.get(r.event_id)?.score ?? -1
    if (r.score > prev) {
      scores.set(r.event_id, {
        score: r.score,
        matchPercent: r.match_percent ?? Math.round((r.score / 3.0) * 100),
        rating: r.rating,
        ratingReason: r.rating_reason,
        hostRating: r.host_rating,
      })
    }
  }
  return scores
}

// Writes the user's thumbs-up / thumbs-down (or clears it). Returns true
// when the (event, user) row existed and was updated. Callers should
// short-circuit if false so we don't fire an admin notification for a
// rating that didn't actually land.
export async function setMatchRating(params: {
  eventId: string
  userId: string
  rating: MatchRating | null
  reason: string | null
}): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('matches')
    .update({
      rating: params.rating,
      // Clear the reason whenever we leave not_a_fit state — no stale
      // explanation on a row the user later changed.
      rating_reason: params.rating === 'not_a_fit' ? params.reason : null,
      rated_at: params.rating ? new Date().toISOString() : null,
    })
    .eq('event_id', params.eventId)
    .eq('user_id', params.userId)
    .select('event_id')
  if (error) throw new Error(`setMatchRating failed: ${error.message}`)
  return (data?.length ?? 0) > 0
}

// Aggregates lifetime up/down counts per user. Drives the "Rating"
// column on the admin users list. Explicit high limit overrides PostgREST's
// default max_rows so the table is never silently truncated.
export async function getRatingCountsByUserId(): Promise<
  Map<string, { going: number; cantMakeIt: number; notAFit: number }>
> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('matches')
    .select('user_id, rating')
    .not('rating', 'is', null)
    .limit(100_000)
  if (error) throw new Error(`getRatingCountsByUserId failed: ${error.message}`)
  const counts = new Map<string, { going: number; cantMakeIt: number; notAFit: number }>()
  for (const row of data ?? []) {
    const r = row as { user_id: string; rating: MatchRating | null }
    if (!r.user_id || !r.rating) continue
    const c = counts.get(r.user_id) ?? { going: 0, cantMakeIt: 0, notAFit: 0 }
    if (r.rating === 'going') c.going++
    else if (r.rating === 'cant_make_it') c.cantMakeIt++
    else if (r.rating === 'not_a_fit') c.notAFit++
    counts.set(r.user_id, c)
  }
  return counts
}

// Single-user rating count. Used by the rating API to decide whether to
// pop the "thanks, help us grow" modal — fires on Going milestone counts.
export async function getRatingCountByUserId(
  userId: string,
): Promise<{ going: number; cantMakeIt: number; notAFit: number }> {
  if (!userId) return { going: 0, cantMakeIt: 0, notAFit: 0 }
  const supabase = getClient()
  const { data, error } = await supabase
    .from('matches')
    .select('rating')
    .eq('user_id', userId)
    .not('rating', 'is', null)
  if (error) {
    console.error('getRatingCountByUserId error', { userId, error })
    return { going: 0, cantMakeIt: 0, notAFit: 0 }
  }
  let going = 0; let cantMakeIt = 0; let notAFit = 0
  for (const row of (data ?? []) as Array<{ rating: MatchRating | null }>) {
    if (row.rating === 'going') going++
    else if (row.rating === 'cant_make_it') cantMakeIt++
    else if (row.rating === 'not_a_fit') notAFit++
  }
  return { going, cantMakeIt, notAFit }
}

export interface MatchAuditRow {
  event_id: string
  score: number
  match_percent: number | null
  location_score: number | null
  audience_score: number | null
  quality_score: number | null
  preference_score: number | null
  skipped_reason: string | null
}

export interface DigestMatchRow {
  event_id: string
  score: number
  match_percent: number | null
  notified_at: string | null
  host_rating: 'up' | 'down' | null
}

export async function getUnnotifiedMatchesForUser(
  userId: string,
  futureEventIds: string[],
): Promise<DigestMatchRow[]> {
  if (futureEventIds.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from('matches')
    .select('event_id, score, match_percent, notified_at, host_rating')
    .eq('user_id', userId)
    .is('notified_at', null)
    .gte('match_percent', MATCH_PERCENT_THRESHOLD)
    .in('event_id', futureEventIds)
    .order('match_percent', { ascending: false })
  if (error) throw new Error(`getUnnotifiedMatchesForUser failed: ${error.message}`)
  return (data ?? []) as DigestMatchRow[]
}

export async function getUpcomingMatchesForUser(
  userId: string,
  futureEventIds: string[],
): Promise<DigestMatchRow[]> {
  if (futureEventIds.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from('matches')
    .select('event_id, score, match_percent, notified_at, host_rating')
    .eq('user_id', userId)
    .gte('match_percent', MATCH_PERCENT_THRESHOLD)
    .in('event_id', futureEventIds)
    .order('match_percent', { ascending: false })
  if (error) throw new Error(`getUpcomingMatchesForUser failed: ${error.message}`)
  return (data ?? []) as DigestMatchRow[]
}

// Returns user_id -> count of future event matches at match_percent >= 40.
// Uses individual COUNT queries per user (head:true = no rows returned) to
// avoid PostgREST max_rows limits that silently truncate bulk .in() results.
export async function getMatchCountsByUserId(
  futureEventIds: string[],
  userIds: string[],
): Promise<Map<string, number>> {
  if (futureEventIds.length === 0 || userIds.length === 0) return new Map()
  const supabase = getClient()
  const counts = new Map<string, number>()
  await Promise.all(
    userIds.map(async (uid) => {
      const { count, error } = await supabase
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', uid)
        .gte('match_percent', MATCH_PERCENT_THRESHOLD)
        .in('event_id', futureEventIds)
      if (error) {
        console.error('getMatchCountsByUserId error', { uid, error })
        return
      }
      if (count !== null) counts.set(uid, count)
    }),
  )
  return counts
}

// Returns event_id -> count of distinct users confirmed within the 150-mile
// matching radius for each event. A user is "in region" when their
// location_score > 0 — meaning the scoring pass ran and placed them inside
// MAX_MILES. This excludes grade_c (location never computed) and location_zero
// (explicitly out of range), so it's an accurate "nearby eligible population"
// denominator for the host UI.
// Uses individual COUNT queries per event (head:true = no rows returned) to
// avoid PostgREST max_rows limits that silently truncate bulk .in() results.
export async function getRegionCountsByEventId(
  eventIds: string[],
): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map()
  const supabase = getClient()
  const counts = new Map<string, number>()
  await Promise.all(
    eventIds.map(async (id) => {
      const { count, error } = await supabase
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', id)
        .gt('location_score', 0)
      if (error) {
        console.error('getRegionCountsByEventId error', { id, error })
        return
      }
      if (count !== null) counts.set(id, count)
    }),
  )
  return counts
}

// Returns event_id -> count of matches with match_percent >= 40.
// Mirrors the threshold used on the event detail page so list and detail agree.
// Uses individual COUNT queries per event (head:true = no rows returned) to
// avoid PostgREST max_rows limits that silently truncate bulk .in() results.
export async function getMatchCountsByEventId(
  eventIds: string[],
): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map()
  const supabase = getClient()
  const counts = new Map<string, number>()
  await Promise.all(
    eventIds.map(async (id) => {
      const { count, error } = await supabase
        .from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', id)
        .gte('match_percent', 40)
      if (error) {
        console.error('getMatchCountsByEventId error', { id, error })
        return
      }
      if (count !== null) counts.set(id, count)
    }),
  )
  return counts
}

export interface EventMatchRow {
  user_id: string
  score: number
  match_percent: number | null
  location_score: number | null
  audience_score: number | null
  quality_score: number | null
  preference_score: number | null
  skipped_reason: string | null
  rating?: 'going' | 'cant_make_it' | 'not_a_fit' | null
  rating_reason?: string | null
  host_rating?: 'up' | 'down' | null
  host_feedback?: string | null
}

// EVERY match row for an event, including below-threshold and skipped
// rows. Used by the admin event-detail page so we can show why each
// in-range user didn't match (and their score breakdown when scored).
export async function getAllMatchesForEvent(eventId: string): Promise<EventMatchRow[]> {
  if (!eventId) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from('matches')
    .select(
      'user_id, score, match_percent, location_score, audience_score, quality_score, preference_score, skipped_reason',
    )
    .eq('event_id', eventId)
  if (error) {
    console.error('getAllMatchesForEvent error', error)
    return []
  }
  return (data ?? []) as EventMatchRow[]
}

// All matches at match_percent >= 40 for an event, ordered by match_percent desc.
// Used by the host detail page.
export async function getMatchesForEvent(eventId: string): Promise<EventMatchRow[]> {
  if (!eventId) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from('matches')
    .select('user_id, score, match_percent, location_score, audience_score, quality_score, preference_score, rating, rating_reason, host_rating, host_feedback')
    .eq('event_id', eventId)
    .gte('match_percent', MATCH_PERCENT_THRESHOLD)
    .order('match_percent', { ascending: false })
  if (error) {
    console.error('getMatchesForEvent error', error)
    return []
  }
  return (data ?? []) as EventMatchRow[]
}

// Writes the host's thumbs-up / thumbs-down (or clears it) for a guest match.
// Returns true when the (event, user) row existed and was updated.
export async function setHostMatchRating(params: {
  eventId: string
  userId: string
  rating: 'up' | 'down' | null
  feedback?: string | null
}): Promise<boolean> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('matches')
    .update({
      host_rating: params.rating,
      host_feedback: params.rating === 'down' ? (params.feedback ?? null) : null,
      host_rated_at: params.rating ? new Date().toISOString() : null,
    })
    .eq('event_id', params.eventId)
    .eq('user_id', params.userId)
    .select('event_id')
  if (error) throw new Error(`setHostMatchRating failed: ${error.message}`)
  return (data?.length ?? 0) > 0
}

// Stamps notified_at on every still-unnotified match for the user. Used when a
// user flips from Paused (or no preference) to a digest frequency so they
// don't get drip-fed the entire backlog 3 events at a time.
export async function markAllMatchesNotifiedForUser(userId: string): Promise<void> {
  const supabase = getClient()
  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('matches')
    .update({ notified_at: nowIso })
    .eq('user_id', userId)
    .is('notified_at', null)
  if (error) {
    console.error('markAllMatchesNotifiedForUser error', { userId, error })
  }
}

// Count of (user, event) matches we've notified about in the last N
// days. Powers the public "X event matches last 30 days" counter under
// the Find Events CTA on the homepage. count='exact' + head=true means
// Supabase returns just the number, not the row data.
export async function getRecentNotifiedMatchCount(days: number): Promise<number> {
  const supabase = getClient()
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
  const { count, error } = await supabase
    .from('matches')
    .select('*', { count: 'exact', head: true })
    .gte('notified_at', cutoff)
  if (error) {
    console.error('getRecentNotifiedMatchCount error', { days, error })
    return 0
  }
  return count ?? 0
}

export async function markMatchesNotified(
  pairs: Array<{ eventId: string; userId: string }>,
): Promise<void> {
  if (pairs.length === 0) return
  const supabase = getClient()
  const nowIso = new Date().toISOString()
  // No bulk update-by-pair primitive in PostgREST; loop with per-row updates.
  // Volume is bounded: at most 3 pairs per digest send.
  for (const { eventId, userId } of pairs) {
    const { error } = await supabase
      .from('matches')
      .update({ notified_at: nowIso })
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .is('notified_at', null)
    if (error) {
      console.error('markMatchesNotified error', { eventId, userId, error })
    }
  }
}

export interface DigestState {
  next_monthly_digest_at: string
  last_monthly_digest_sent_at: string | null
}

export async function getDigestState(userId: string): Promise<DigestState | null> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('user_digest_state')
    .select('next_monthly_digest_at, last_monthly_digest_sent_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('getDigestState error', { userId, error })
    return null
  }
  return (data as DigestState | null) ?? null
}

export async function upsertDigestState(
  userId: string,
  fields: { nextMonthly: string; lastSent?: string | null },
): Promise<void> {
  const supabase = getClient()
  const row: Record<string, unknown> = {
    user_id: userId,
    next_monthly_digest_at: fields.nextMonthly,
  }
  if (fields.lastSent !== undefined) {
    row.last_monthly_digest_sent_at = fields.lastSent
  }
  const { error } = await supabase
    .from('user_digest_state')
    .upsert(row, { onConflict: 'user_id' })
  if (error) {
    console.error('upsertDigestState error', { userId, error })
  }
}

export async function getAllMatchesForUser(userId: string): Promise<MatchAuditRow[]> {
  const supabase = getClient()
  const { data } = await supabase
    .from('matches')
    .select('event_id, score, match_percent, location_score, audience_score, quality_score, preference_score, skipped_reason')
    .eq('user_id', userId)
    .order('score', { ascending: false })
  return (data ?? []) as MatchAuditRow[]
}

export async function createMagicToken(email: string): Promise<string> {
  const supabase = getClient()
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
  const { error } = await supabase.from('magic_link_tokens').insert({
    email,
    token,
    expires_at: expiresAt.toISOString(),
  })
  if (error) throw new Error(`magic_link_tokens insert failed: ${error.message}`)
  return token
}

export async function verifyMagicToken(token: string): Promise<string | null> {
  const supabase = getClient()
  const { data } = await supabase
    .from('magic_link_tokens')
    .select('email, expires_at, used_at')
    .eq('token', token)
    .maybeSingle()

  if (!data || data.used_at || new Date(data.expires_at) < new Date()) return null

  await supabase
    .from('magic_link_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)

  return data.email
}

// Sessions store both user_id and email during the transition window.
// user_id is the join key going forward; email is kept for one deploy
// cycle so a rollback is possible. A later migration drops the email
// column once nothing reads it.
export async function createSession(userId: string, email: string): Promise<string> {
  const supabase = getClient()
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 days
  const { error } = await supabase.from('sessions').insert({
    user_id: userId,
    email,
    token,
    expires_at: expiresAt.toISOString(),
  })
  if (error) throw new Error(`sessions insert failed: ${error.message}`)
  return token
}

// Bumps last_seen_at if older than this. Throttles writes on the auth path —
// /api/auth/me runs on every dashboard page load, we don't need per-request
// precision for "last visited."
const SESSION_TOUCH_THROTTLE_MS = 5 * 60_000

// Returns { userId, email } for a valid session token, or null if the
// token is invalid/expired. Callers should treat userId as the join key
// for any downstream Supabase reads (matches, digest_sends, etc.) and
// use email purely as a display attribute.
export async function verifySession(
  token: string,
): Promise<{ userId: string; email: string } | null> {
  const supabase = getClient()
  let { data, error } = await supabase
    .from('sessions')
    .select('user_id, email, expires_at, last_seen_at')
    .eq('token', token)
    .maybeSingle()

  // If the last_seen_at column hasn't been added yet (schema migration not
  // applied), retry with only the columns we know exist so auth still works.
  if (error && /last_seen_at/i.test(error.message ?? '')) {
    console.warn('verifySession: last_seen_at column missing, falling back', error.message)
    const fallback = await supabase
      .from('sessions')
      .select('user_id, email, expires_at')
      .eq('token', token)
      .maybeSingle()
    data = fallback.data as typeof data
    error = fallback.error
  }

  if (error) {
    console.error('verifySession query error', error)
    return null
  }
  if (!data || new Date(data.expires_at) < new Date()) return null

  // Fire-and-forget: don't block auth on the write, and don't fail the
  // request if the touch errors. Skipped when last_seen_at isn't on the row
  // (column missing on this DB).
  const seen = (data as { last_seen_at?: string | null }).last_seen_at
  if (seen) {
    const lastSeenMs = new Date(seen).getTime()
    if (Date.now() - lastSeenMs > SESSION_TOUCH_THROTTLE_MS) {
      supabase
        .from('sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('token', token)
        .then(({ error }) => {
          if (error) console.error('verifySession touch error', error)
        })
    }
  }

  // Pre-migration sessions may have a NULL user_id (backfill catches
  // active rows but rare edge cases slip through). Fail closed so the
  // user is forced to re-login rather than getting a half-broken state.
  if (!data.user_id) {
    console.warn('verifySession: session has null user_id', { token: token.slice(0, 8) })
    return null
  }

  return { userId: data.user_id, email: data.email }
}

// Returns user_id -> ISO last_seen_at (latest across all of that user's
// sessions). Used by the admin overview as a "last visit" signal.
export async function getLastSeenByUserId(): Promise<Map<string, string>> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('sessions')
    .select('user_id, last_seen_at')
    .order('last_seen_at', { ascending: false })
  if (error) {
    console.error('getLastSeenByUserId error', error)
    return new Map()
  }
  const out = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ user_id: string | null; last_seen_at: string | null }>) {
    if (!row.user_id || !row.last_seen_at) continue
    // First row per key wins (data is sorted by last_seen_at desc).
    if (!out.has(row.user_id)) out.set(row.user_id, row.last_seen_at)
  }
  return out
}

// Returns a map of "eventId:userId" -> inputs_hash for every row in
// `matches` covering the given future events. Used by the admin rescore
// endpoint to detect missing pairs (key absent) AND stale pairs (key
// present but hash differs from the current MATCHING_VERSION hash).
// Queries per-event in parallel with an explicit high limit to avoid
// PostgREST max_rows silently truncating a bulk cross-product fetch.
export async function getExistingMatchHashes(
  eventIds: string[],
): Promise<Map<string, string | null>> {
  if (eventIds.length === 0) return new Map()
  const supabase = getClient()
  const out = new Map<string, string | null>()
  await Promise.all(
    eventIds.map(async (eventId) => {
      const { data, error } = await supabase
        .from('matches')
        .select('user_id, inputs_hash')
        .eq('event_id', eventId)
        .limit(10_000)
      if (error) {
        console.error('getExistingMatchHashes error', { eventId, error })
        return
      }
      for (const row of (data ?? []) as Array<{ user_id: string; inputs_hash: string | null }>) {
        if (row.user_id) out.set(`${eventId}:${row.user_id}`, row.inputs_hash ?? null)
      }
    }),
  )
  return out
}

export interface DigestSendLog {
  userId: string
  // Same story as MatchLog.userEmail — present to satisfy the legacy
  // NOT NULL constraint on digest_sends.user_email; nothing reads it.
  userEmail: string
  kind: 'per_event' | 'cron' | 'welcome' | 'blast' | 'coaching' | 'recap'
  eventIds: string[]
}

// Records a real digest send to the digest_sends log. Only call this from
// inside lib/email.ts after the email has actually been dispatched to
// Resend without error. We log every send except per_event/cron with no
// events (those should never reach this function — sendUserDigest early-
// returns when the digest is empty). Welcome / blast / coaching always
// log, even with empty eventIds, so the 'Last sent' clock catches them.
//
// user_email is written purely to satisfy the legacy NOT NULL constraint
// on digest_sends.user_email. Every reader joins by user_id; nothing
// queries this column. A follow-up migration drops it.
export async function logDigestSend(entry: DigestSendLog): Promise<void> {
  if (
    entry.eventIds.length === 0 &&
    entry.kind !== 'blast' &&
    entry.kind !== 'coaching' &&
    entry.kind !== 'welcome'
  ) {
    return
  }
  const supabase = getClient()
  const { error } = await supabase.from('digest_sends').insert({
    user_id: entry.userId,
    user_email: entry.userEmail,
    kind: entry.kind,
    event_ids: entry.eventIds,
  })
  if (error) {
    console.error('logDigestSend error', { entry, error })
  }
}

// Returns user_id -> ISO timestamp of the most recent digest send. Reads
// from digest_sends so it includes ONLY emails that contained events —
// never the silent notified_at stamps from a Frequency flip. Excludes
// admin blast sends (kind='blast') so the admin 'Last sent' column stays
// semantically "last matching-event digest."
// Explicit high limit overrides PostgREST default max_rows; digest_sends
// grows unboundedly so we must not let it silently truncate.
export async function getLastDigestSentByUserId(): Promise<Map<string, string>> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('digest_sends')
    .select('user_id, sent_at')
    .neq('kind', 'blast')
    .order('sent_at', { ascending: false })
    .limit(100_000)
  if (error) {
    console.error('getLastDigestSentByUserId error', error)
    return new Map()
  }
  const out = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ user_id: string | null; sent_at: string | null }>) {
    if (!row.user_id || !row.sent_at) continue
    if (!out.has(row.user_id)) out.set(row.user_id, row.sent_at)
  }
  return out
}

// Companion reader: last admin blast send per user. Same digest_sends
// table, filtered to kind='blast'.
export async function getLastBlastSentByUserId(): Promise<Map<string, string>> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('digest_sends')
    .select('user_id, sent_at')
    .eq('kind', 'blast')
    .order('sent_at', { ascending: false })
  if (error) {
    console.error('getLastBlastSentByUserId error', error)
    return new Map()
  }
  const out = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ user_id: string | null; sent_at: string | null }>) {
    if (!row.user_id || !row.sent_at) continue
    if (!out.has(row.user_id)) out.set(row.user_id, row.sent_at)
  }
  return out
}

export async function getLastSeenForUser(userId: string): Promise<string | null> {
  if (!userId) return null
  const supabase = getClient()
  const { data, error } = await supabase
    .from('sessions')
    .select('last_seen_at')
    .eq('user_id', userId)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('getLastSeenForUser error', error)
    return null
  }
  return (data as { last_seen_at: string } | null)?.last_seen_at ?? null
}

// Most recent email of ANY kind sent to this user (digest OR admin blast OR
// welcome/coaching). Powers the "Last email sent" field on the admin user
// detail card. Different from getLastDigestSentByEmail which deliberately
// excludes blasts so the dashboard's Sent column stays semantically scoped
// to event-bearing digests — for the detail card the admin just wants to
// know when we last reached out, period.
export async function getLastEmailSentForUser(userId: string): Promise<string | null> {
  if (!userId) return null
  const supabase = getClient()
  const { data, error } = await supabase
    .from('digest_sends')
    .select('sent_at')
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('getLastEmailSentForUser error', error)
    return null
  }
  return (data as { sent_at: string } | null)?.sent_at ?? null
}

export async function deleteSession(token: string): Promise<void> {
  const supabase = getClient()
  await supabase.from('sessions').delete().eq('token', token)
}

// =====================
// Contributions
// =====================
//
// One row per event submission. Source of truth for "who submitted what,
// when." Captures contributions from people who haven't signed up yet
// (airtable_user_id is NULL until they do); linkContributionsToUser backfills
// the user_id when they finish signup.

export interface ContributionStats {
  total: number
  last30: number
  last90: number
  lastAt: string | null
}

export async function recordContribution(opts: {
  email: string
  eventId?: string
  eventName?: string
  source: 'form' | 'inbound_email' | 'check_event'
  airtableUserId?: string | null
}): Promise<void> {
  const email = (opts.email || '').trim().toLowerCase()
  if (!email) {
    console.error('recordContribution: missing email')
    return
  }
  const supabase = getClient()
  const { error } = await supabase.from('contributions').insert({
    submitter_email: email,
    event_id: opts.eventId ?? null,
    event_name: opts.eventName ?? null,
    airtable_user_id: opts.airtableUserId ?? null,
    source: opts.source,
  })
  if (error) {
    console.error('recordContribution error', { email, source: opts.source, error })
  }
}

// Idempotent. Attributes any prior contributions matching this email to the
// freshly-created/approved user record.
export async function linkContributionsToUser(
  userId: string,
  email: string,
): Promise<number> {
  const cleaned = (email || '').trim().toLowerCase()
  if (!userId || !cleaned) return 0
  const supabase = getClient()
  const { data, error } = await supabase
    .from('contributions')
    .update({ airtable_user_id: userId })
    .ilike('submitter_email', cleaned)
    .is('airtable_user_id', null)
    .select('id')
  if (error) {
    console.error('linkContributionsToUser error', { userId, cleaned, error })
    return 0
  }
  return (data ?? []).length
}

// Email-based contribution stats. Use for pre-signup paths (check-email,
// inbound-email, submit-event) where the contributor has no user_id yet.
// Post-signup paths should call getContributionStatsForUser instead so the
// answer is keyed by the canonical join.
export async function getContributionStatsByEmail(email: string): Promise<ContributionStats> {
  const cleaned = (email || '').trim().toLowerCase()
  if (!cleaned) return { total: 0, last30: 0, last90: 0, lastAt: null }
  const supabase = getClient()
  const { data, error } = await supabase
    .from('contributions')
    .select('submitted_at')
    .ilike('submitter_email', cleaned)
    .order('submitted_at', { ascending: false })
  if (error) {
    console.error('getContributionStatsByEmail error', { cleaned, error })
    return { total: 0, last30: 0, last90: 0, lastAt: null }
  }
  return computeContributionStats(data ?? [])
}

export async function getContributionStatsForUser(userId: string): Promise<ContributionStats> {
  if (!userId) return { total: 0, last30: 0, last90: 0, lastAt: null }
  const supabase = getClient()
  const { data, error } = await supabase
    .from('contributions')
    .select('submitted_at')
    .eq('airtable_user_id', userId)
    .order('submitted_at', { ascending: false })
  if (error) {
    console.error('getContributionStatsForUser error', { userId, error })
    return { total: 0, last30: 0, last90: 0, lastAt: null }
  }
  return computeContributionStats(data ?? [])
}

function computeContributionStats(rows: Array<{ submitted_at: string }>): ContributionStats {
  const now = Date.now()
  const day = 86_400_000
  let last30 = 0
  let last90 = 0
  for (const r of rows) {
    const t = new Date(r.submitted_at).getTime()
    if (Number.isFinite(t)) {
      if (now - t <= 30 * day) last30++
      if (now - t <= 90 * day) last90++
    }
  }
  return {
    total: rows.length,
    last30,
    last90,
    lastAt: rows[0]?.submitted_at ?? null,
  }
}

// Bulk version of getContributionStatsForUser — one query, returns total
// + lastAt keyed by user_id. Used by the admin overview to avoid N
// round-trips. Pre-signup contributions (airtable_user_id IS NULL) are
// excluded — they aren't owned by a user yet.
export async function getContributionTotalsByUserId(): Promise<
  Map<string, { total: number; lastAt: string | null }>
> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('contributions')
    .select('airtable_user_id, submitted_at')
    .not('airtable_user_id', 'is', null)
    .order('submitted_at', { ascending: false })
  if (error) {
    console.error('getContributionTotalsByUserId error', error)
    return new Map()
  }
  const out = new Map<string, { total: number; lastAt: string | null }>()
  for (const row of (data ?? []) as Array<{ airtable_user_id: string | null; submitted_at: string }>) {
    const key = row.airtable_user_id
    if (!key) continue
    const cur = out.get(key)
    if (cur) {
      cur.total++
      // submitted_at desc means the first row we see per key is the latest.
    } else {
      out.set(key, { total: 1, lastAt: row.submitted_at })
    }
  }
  return out
}

export interface ContributionRow {
  id: string
  submitter_email: string
  event_id: string | null
  event_name: string | null
  airtable_user_id: string | null
  source: string
  submitted_at: string
}

export async function getRecentContributions(opts: {
  sinceDays?: number
  limit?: number
}): Promise<ContributionRow[]> {
  const supabase = getClient()
  let query = supabase
    .from('contributions')
    .select('id, submitter_email, event_id, event_name, airtable_user_id, source, submitted_at')
    .order('submitted_at', { ascending: false })
    .limit(opts.limit ?? 500)
  if (opts.sinceDays) {
    const cutoff = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString()
    query = query.gte('submitted_at', cutoff)
  }
  const { data, error } = await query
  if (error) {
    console.error('getRecentContributions error', error)
    return []
  }
  return (data ?? []) as ContributionRow[]
}


// ---------------- Topics ----------------
// Curated chip-picker tags. Admin owns these via /admin/topics. The
// chip picker reads via the public GET /api/topics endpoint.

import type { TaxonomyLabel, DefaultTopic } from './topics'

export interface Topic {
  id: string
  name: string
  taxonomy: TaxonomyLabel | string
  sortOrder: number
  createdAt: string
}

interface TopicRow {
  id: string
  name: string
  taxonomy: string
  sort_order: number
  created_at: string
}

function rowToTopic(r: TopicRow): Topic {
  return {
    id: r.id,
    name: r.name,
    taxonomy: r.taxonomy,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }
}

export async function getTopics(): Promise<Topic[]> {
  const supabase = getClient()
  const { data, error } = await supabase
    .from('topics')
    .select('id, name, taxonomy, sort_order, created_at')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) {
    console.error('getTopics error', error)
    return []
  }
  return ((data ?? []) as TopicRow[]).map(rowToTopic)
}

export async function createTopic(name: string, taxonomy: string): Promise<Topic | null> {
  const trimmedName = name.trim()
  const trimmedTaxonomy = taxonomy.trim()
  if (!trimmedName || !trimmedTaxonomy) return null
  const supabase = getClient()
  // Append within the chosen taxonomy — find the current max sort_order
  // for that taxonomy and place this row one past it.
  const { data: maxRow } = await supabase
    .from('topics')
    .select('sort_order')
    .eq('taxonomy', trimmedTaxonomy)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = (maxRow?.sort_order ?? -1) + 1
  const { data, error } = await supabase
    .from('topics')
    .insert({ name: trimmedName, taxonomy: trimmedTaxonomy, sort_order: nextOrder })
    .select('id, name, taxonomy, sort_order, created_at')
    .single()
  if (error) {
    // Unique-constraint violation (duplicate name) lands here too.
    console.error('createTopic error', error)
    return null
  }
  return rowToTopic(data as TopicRow)
}

// Patch a single topic. Either field is optional. Returns the updated
// row or null on failure.
export async function updateTopic(
  id: string,
  patch: { name?: string; taxonomy?: string },
): Promise<Topic | null> {
  if (!id) return null
  const update: Record<string, string> = {}
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim()
    if (!trimmed) return null
    update.name = trimmed
  }
  if (patch.taxonomy !== undefined) {
    const trimmed = patch.taxonomy.trim()
    if (!trimmed) return null
    update.taxonomy = trimmed
  }
  if (Object.keys(update).length === 0) return null
  const supabase = getClient()
  const { data, error } = await supabase
    .from('topics')
    .update(update)
    .eq('id', id)
    .select('id, name, taxonomy, sort_order, created_at')
    .single()
  if (error) {
    console.error('updateTopic error', error)
    return null
  }
  return rowToTopic(data as TopicRow)
}

export async function deleteTopic(id: string): Promise<boolean> {
  if (!id) return false
  const supabase = getClient()
  const { error } = await supabase.from('topics').delete().eq('id', id)
  if (error) {
    console.error('deleteTopic error', error)
    return false
  }
  return true
}

// Reassigns sort_order for the full ordered list of topic IDs. Called
// when admin reorders via the up/down arrows on /admin/topics. sort_order
// is set to the global index — taxonomy grouping is purely a display
// concern, so a single global ordering is sufficient.
export async function reorderTopics(orderedIds: string[]): Promise<boolean> {
  if (orderedIds.length === 0) return true
  const supabase = getClient()
  const updates = orderedIds.map((id, i) =>
    supabase.from('topics').update({ sort_order: i }).eq('id', id),
  )
  const results = await Promise.all(updates)
  const firstErr = results.find((r) => r.error)
  if (firstErr?.error) {
    console.error('reorderTopics error', firstErr.error)
    return false
  }
  return true
}

// Bulk insert used by the "Seed defaults" admin button. No-op if the
// table already has rows. Returns the number of rows inserted (0 if
// nothing was seeded).
export async function seedTopicsIfEmpty(defaults: DefaultTopic[]): Promise<number> {
  const supabase = getClient()
  const { count, error: countErr } = await supabase
    .from('topics')
    .select('id', { count: 'exact', head: true })
  if (countErr) {
    console.error('seedTopicsIfEmpty count error', countErr)
    return 0
  }
  if ((count ?? 0) > 0) return 0
  const rows = defaults.map((t, i) => ({
    name: t.name,
    taxonomy: t.taxonomy,
    sort_order: i,
  }))
  const { error } = await supabase.from('topics').insert(rows)
  if (error) {
    console.error('seedTopicsIfEmpty insert error', error)
    return 0
  }
  return rows.length
}

export async function deleteUser(userId: string): Promise<void> {
  const supabase = getClient()
  await Promise.all([
    supabase.from('matches').delete().eq('user_id', userId),
    supabase.from('sessions').delete().eq('user_id', userId),
    supabase.from('user_digest_state').delete().eq('user_id', userId),
  ])
  const { error } = await supabase
    .from('users')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw new Error(`deleteUser failed: ${error.message}`)
}

export async function deleteEvent(eventId: string): Promise<void> {
  const supabase = getClient()
  await supabase.from('matches').delete().eq('event_id', eventId)
  const { error } = await supabase
    .from('events')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', eventId)
  if (error) throw new Error(`deleteEvent failed: ${error.message}`)
}
