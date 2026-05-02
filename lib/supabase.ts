import { createClient } from '@supabase/supabase-js'

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
