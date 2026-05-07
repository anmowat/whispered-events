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
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
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
