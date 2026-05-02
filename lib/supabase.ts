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

export async function logMatch(
  eventId: string,
  userId: string,
  userEmail: string,
  score: number
): Promise<void> {
  const supabase = getClient()
  await supabase.from('matches').upsert(
    { event_id: eventId, user_id: userId, user_email: userEmail, score },
    { onConflict: 'event_id,user_id', ignoreDuplicates: true }
  )
}

export async function getMatchedEventIds(userEmail: string): Promise<Set<string>> {
  const supabase = getClient()
  const { data } = await supabase
    .from('matches')
    .select('event_id')
    .eq('user_email', userEmail)
    .gte('score', 0.75)
  return new Set((data ?? []).map((m: { event_id: string }) => m.event_id))
}

export async function createMagicToken(email: string): Promise<string> {
  const supabase = getClient()
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
  await supabase.from('magic_link_tokens').insert({
    email,
    token,
    expires_at: expiresAt.toISOString(),
  })
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
  await supabase.from('sessions').insert({
    email,
    token,
    expires_at: expiresAt.toISOString(),
  })
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
