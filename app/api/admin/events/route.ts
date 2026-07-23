import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { getActiveUserLocations } from '@/lib/users'
import { getEventsForAdmin, type EventScope, type FeaturedFilter, type EventStatusBucket } from '@/lib/events'
import { getMatchCountsByEventId, getRatingCountsByEventId } from '@/lib/supabase'
import { withinMiles } from '@/lib/geocode'
import { NEARBY_RADIUS_MILES } from '@/lib/matching'

// Admin events list with per-event match stats:
//   matchCount = unique users with match_percent >= 40
//   usersInRange = active users whose location is geocoded within range
//   matchPct = matchCount / usersInRange (or null when usersInRange = 0)

export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const scope = (url.searchParams.get('scope') as EventScope | null) ?? 'future'
  const featured = (url.searchParams.get('featured') as FeaturedFilter | null) ?? 'all'
  const statusBucketRaw = url.searchParams.get('statusBucket') || 'live'
  const validScope: EventScope =
    scope === 'past' || scope === 'all' ? scope : 'future'
  const validFeatured: FeaturedFilter =
    featured === 'yes' || featured === 'no' ? featured : 'all'
  const validStatusBucket: EventStatusBucket =
    statusBucketRaw === 'toApprove' ||
    statusBucketRaw === 'deactivated' ||
    statusBucketRaw === 'all'
      ? statusBucketRaw
      : 'live'

  try {
    const [allUsers, scopedEvents] = await Promise.all([
      getActiveUserLocations(),
      getEventsForAdmin({
        scope: validScope,
        featured: validFeatured,
        statusBucket: validStatusBucket,
      }),
    ])
    const eventIds = scopedEvents.map((e) => e.id)
    const [matchCounts, ratingCounts] = await Promise.all([
      getMatchCountsByEventId(eventIds),
      getRatingCountsByEventId(eventIds),
    ])

    // getActiveUserLocations already filters to geocoded users only
    const geocodedUsers = allUsers

    const events = scopedEvents.map((e) => {
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
        created: e.created || null,
        location: e.location,
        audience: e.audience,
        lat: e.lat ?? null,
        lng: e.lng ?? null,
        matchCount,
        usersInRange,
        matchPct,
        featured: e.featured === true,
        status: e.status || 'Pending',
        hostCount: (e.hostIds ?? []).length,
        ratings: ratingCounts.get(e.id) ?? { interested: 0, skip: 0, not_a_fit: 0, host_up: 0, host_down: 0 },
      }
    })

    return NextResponse.json({
      events,
      stats: {
        // Name preserved for backwards compat with the existing client; the
        // count reflects the active scope rather than just future events.
        futureEventCount: events.length,
        scope: validScope,
        featured: validFeatured,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/events error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
