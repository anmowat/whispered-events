import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/host-auth'
import { getEventsHostedBy } from '@/lib/events'
import { getMatchCountsByEventId, getRegionCountsByEventId } from '@/lib/supabase'

// Returns the caller's upcoming hosted events with a match count for each.
// Auth: requires a valid session cookie that resolves to a known Airtable
// Users row. No admin gate — every user can list their own hosted events.

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const events = await getEventsHostedBy(user.id)
    const eventIds = events.map((e) => e.id)
    const [counts, regionCounts] = await Promise.all([
      getMatchCountsByEventId(eventIds),
      getRegionCountsByEventId(eventIds),
    ])

    const rows = events
      .map((e) => ({
        id: e.id,
        name: e.name,
        location: e.location,
        date: e.date,
        link: e.link,
        matchCount: counts.get(e.id) ?? 0,
        regionCount: regionCounts.get(e.id) ?? 0,
      }))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    return NextResponse.json({ events: rows })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('host/events error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
