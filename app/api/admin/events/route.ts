import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import {
  getActiveUsers,
  getFutureEvents,
} from '@/lib/airtable'
import { getMatchCountsByEventId } from '@/lib/supabase'
import { withinMiles } from '@/lib/geocode'

const NEARBY_RADIUS_MILES = 100

// Admin events list with per-event match stats:
//   matchCount = unique users with a match row above NOTIFY_THRESHOLD
//   usersInRange = active users whose location is geocoded within 100mi
//   matchPct = matchCount / usersInRange (or null when usersInRange = 0)

export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const [allUsers, futureEvents] = await Promise.all([
      getActiveUsers(),
      getFutureEvents(),
    ])
    const eventIds = futureEvents.map((e) => e.id)
    const matchCounts = await getMatchCountsByEventId(eventIds)

    const geocodedUsers = allUsers.filter(
      (u): u is typeof u & { lat: number; lng: number } =>
        typeof u.lat === 'number' && typeof u.lng === 'number',
    )

    const events = futureEvents.map((e) => {
      const usersInRange =
        typeof e.lat === 'number' && typeof e.lng === 'number'
          ? geocodedUsers.filter((u) =>
              withinMiles(
                { lat: u.lat, lng: u.lng },
                { lat: e.lat as number, lng: e.lng as number },
                NEARBY_RADIUS_MILES,
              ),
            ).length
          : 0
      const matchCount = matchCounts.get(e.id) ?? 0
      const matchPct =
        usersInRange > 0 ? Math.round((matchCount / usersInRange) * 100) : null
      return {
        id: e.id,
        name: e.name,
        type: e.type,
        date: e.date,
        location: e.location,
        audience: e.audience,
        lat: e.lat ?? null,
        lng: e.lng ?? null,
        matchCount,
        usersInRange,
        matchPct,
      }
    })

    return NextResponse.json({
      events,
      stats: {
        futureEventCount: events.length,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/events error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
