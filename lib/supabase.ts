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
//   expires_at timestamptz NOT NULL
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
}

export async function getExistingMatch(
  eventId: string,
  userId: string,
): Promise<MatchRow | null> {
  const supabase = getClient()
  const { data } = await supabase
    .from('matches')
    .select('score, inputs_hash, match_percent')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data as MatchRow | null) ?? null
}

export interface MatchLog {
  eventId: string
  userId: string
  userEmail: string
  score: number
  matchPercent: number
  locationScore: number | null
  audienceScore: number | null
  qualityScore: number | null
  preferenceScore: number | null
  inputsHash: string
  skippedReason?: 'grade_c' | 'location_zero' | null
}

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

const NOTIFY_THRESHOLD = 1.0

export async function getMatchedEventIds(userEmail: string): Promise<Set<string>> {
  const supabase = getClient()
  const { data } = await supabase
    .from('matches')
    .select('event_id')
    .eq('user_email', userEmail)
    .gte('score', NOTIFY_THRESHOLD)
  return new Set((data ?? []).map((m: { event_id: string }) => m.event_id))
}

export async function getMatchScoresForUser(
  userEmail: string,
): Promise<Map<string, { score: number; matchPercent: number }>> {
  const supabase = getClient()
  const { data } = await supabase
    .from('matches')
    .select('event_id, score, match_percent')
    .eq('user_email', userEmail)
  const scores = new Map<string, { score: number; matchPercent: number }>()
  for (const row of data ?? []) {
    const r = row as { event_id: string; score: number; match_percent: number | null }
    const prev = scores.get(r.event_id)?.score ?? -1
    if (r.score > prev) {
      scores.set(r.event_id, {
        score: r.score,
        matchPercent: r.match_percent ?? Math.round((r.score / 3.0) * 100),
      })
    }
  }
  return scores
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
}

export async function getUnnotifiedMatchesForUser(
  userId: string,
  futureEventIds: string[],
  threshold: number,
): Promise<DigestMatchRow[]> {
  if (futureEventIds.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from('matches')
    .select('event_id, score, match_percent, notified_at')
    .eq('user_id', userId)
    .is('notified_at', null)
    .gte('score', threshold)
    .in('event_id', futureEventIds)
    .order('score', { ascending: false })
  if (error) throw new Error(`getUnnotifiedMatchesForUser failed: ${error.message}`)
  return (data ?? []) as DigestMatchRow[]
}

export async function getUpcomingMatchesForUser(
  userId: string,
  futureEventIds: string[],
  threshold: number,
): Promise<DigestMatchRow[]> {
  if (futureEventIds.length === 0) return []
  const supabase = getClient()
  const { data, error } = await supabase
    .from('matches')
    .select('event_id, score, match_percent, notified_at')
    .eq('user_id', userId)
    .gte('score', threshold)
    .in('event_id', futureEventIds)
    .order('score', { ascending: false })
  if (error) throw new Error(`getUpcomingMatchesForUser failed: ${error.message}`)
  return (data ?? []) as DigestMatchRow[]
}

// Returns email -> count of distinct future event matches above NOTIFY_THRESHOLD
// for every user that has at least one. Mirrors the filter the user dashboard
// applies (score >= 1.0, skipped_reason IS NULL, future event_id). Single
// Supabase query so the admin overview page stays sub-second.
export async function getMatchCountsByEmail(
  futureEventIds: string[],
): Promise<Map<string, number>> {
  if (futureEventIds.length === 0) return new Map()
  const supabase = getClient()
  const { data, error } = await supabase
    .from('matches')
    .select('user_email, event_id')
    .gte('score', NOTIFY_THRESHOLD)
    .is('skipped_reason', null)
    .in('event_id', futureEventIds)
  if (error) throw new Error(`getMatchCountsByEmail failed: ${error.message}`)
  // Dedupe (user_email, event_id) pairs in case of stray duplicates, then count.
  // forEach (rather than for-of) avoids needing the downlevelIteration tsconfig flag.
  const seen = new Map<string, Set<string>>()
  for (const row of data ?? []) {
    const r = row as { user_email: string; event_id: string }
    if (!r.user_email || !r.event_id) continue
    const set = seen.get(r.user_email) ?? new Set<string>()
    set.add(r.event_id)
    seen.set(r.user_email, set)
  }
  const counts = new Map<string, number>()
  seen.forEach((set, email) => counts.set(email, set.size))
  return counts
}

// Stamps notified_at on every still-unnotified match for the user. Used when a
// user flips from Dashboard Only (or no preference) to a digest frequency so
// they don't get drip-fed the entire backlog 3 events at a time.
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

export async function getAllMatchesForUser(userEmail: string): Promise<MatchAuditRow[]> {
  const supabase = getClient()
  const { data } = await supabase
    .from('matches')
    .select('event_id, score, match_percent, location_score, audience_score, quality_score, preference_score, skipped_reason')
    .eq('user_email', userEmail)
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

export async function createSession(email: string): Promise<string> {
  const supabase = getClient()
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // 60 days
  const { error } = await supabase.from('sessions').insert({
    email,
    token,
    expires_at: expiresAt.toISOString(),
  })
  if (error) throw new Error(`sessions insert failed: ${error.message}`)
  return token
}

export async function verifySession(token: string): Promise<string | null> {
  const supabase = getClient()
  const { data } = await supabase
    .from('sessions')
    .select('email, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!data || new Date(data.expires_at) < new Date()) return null
  return data.email
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

export async function getContributionStats(email: string): Promise<ContributionStats> {
  const cleaned = (email || '').trim().toLowerCase()
  if (!cleaned) return { total: 0, last30: 0, last90: 0, lastAt: null }
  const supabase = getClient()
  const { data, error } = await supabase
    .from('contributions')
    .select('submitted_at')
    .ilike('submitter_email', cleaned)
    .order('submitted_at', { ascending: false })
  if (error) {
    console.error('getContributionStats error', { cleaned, error })
    return { total: 0, last30: 0, last90: 0, lastAt: null }
  }
  const rows = (data ?? []) as Array<{ submitted_at: string }>
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
