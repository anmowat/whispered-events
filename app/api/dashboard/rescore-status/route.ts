import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifySession } from '@/lib/supabase'
import { getUserByEmail } from '@/lib/users'
import { getFutureEvents } from '@/lib/events'
import { computeInputsHash } from '@/lib/matching'

// Poll endpoint for the dashboard's "AI is re-running your matches" modal.
// For the logged-in user, compares every future event's cached match
// `inputs_hash` against a freshly-computed hash. Returns `pending`: the
// number of stale or missing rows. When pending === 0, the rescore that
// the profile save kicked off has fully landed and the client can reload.
//
// Cheap: one Supabase query + N pure-JS SHA-256s. No LLM calls.

export const maxDuration = 10

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value
  if (!sessionToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const email = await verifySession(sessionToken)
  if (!email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const [user, events] = await Promise.all([
      getUserByEmail(email),
      getFutureEvents(),
    ])
    if (!user) {
      return NextResponse.json({ error: 'user not found' }, { status: 404 })
    }
    if (events.length === 0) {
      return NextResponse.json({ pending: 0, total: 0 })
    }

    const eventIds = events.map((e) => e.id)
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('matches')
      .select('event_id, inputs_hash')
      .eq('user_id', user.id)
      .in('event_id', eventIds)
    if (error) {
      console.error('dashboard/rescore-status query error', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const hashByEventId = new Map<string, string | null>()
    for (const row of (data ?? []) as Array<{ event_id: string; inputs_hash: string | null }>) {
      hashByEventId.set(row.event_id, row.inputs_hash ?? null)
    }

    let pending = 0
    for (const event of events) {
      const currentHash = computeInputsHash(event, user)
      const storedHash = hashByEventId.get(event.id) ?? null
      if (storedHash !== currentHash) pending++
    }

    return NextResponse.json({ pending, total: events.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/rescore-status error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
