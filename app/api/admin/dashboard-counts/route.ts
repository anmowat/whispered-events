import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import {
  getMatchCountsByUserId,
  getContributionTotalsByUserId,
  getLastSeenByUserId,
  getLastDigestSentByUserId,
  getLastBlastSentByUserId,
  getMatchesForEvent,
  getRatingCountsByUserId,
} from '@/lib/supabase'
import { getUsersForAdmin, type StatusBucket } from '@/lib/users'
import { getFutureEvents, getFutureEventHostIds } from '@/lib/events'
import { withinMiles } from '@/lib/geocode'
import { NEARBY_RADIUS_MILES } from '@/lib/matching'

// Admin overview: each active user's id/name/email/location + match count for
// events on their dashboard + contribution totals + last-seen timestamp.
// Sub-second via bulk Supabase queries plus the 90s-cached Airtable reads.

export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Optional ?eventId= filter — when set, the response is restricted to
  // users whose match for that event is above the notify threshold. Used
  // by the admin filter popover to slice the list by "matched event".
  const eventIdFilter = req.nextUrl.searchParams.get('eventId') || ''
  // Status bucket filter (Phase H Section C). Defaults to 'live' which is
  // the matching-loop scope and matches today's "active users only" default.
  const statusBucketRaw = req.nextUrl.searchParams.get('statusBucket') || 'live'
  const statusBucket: StatusBucket =
    statusBucketRaw === 'toApprove' ||
    statusBucketRaw === 'deactivated' ||
    statusBucketRaw === 'all'
      ? statusBucketRaw
      : 'live'

  try {
    const [activeUsers, futureEvents, contribStats, lastSeen, lastDigest, lastBlast, ratingCounts, hostIds] = await Promise.all([
      getUsersForAdmin({ statusBucket }),
      getFutureEvents(),
      getContributionTotalsByUserId(),
      getLastSeenByUserId(),
      getLastDigestSentByUserId(),
      getLastBlastSentByUserId(),
      getRatingCountsByUserId(),
      getFutureEventHostIds(),
    ])
    const futureEventIds = futureEvents.map((e) => e.id)
    const counts = await getMatchCountsByUserId(futureEventIds)

    // When eventId is set, intersect users against the match set for
    // that event (already-threshold-filtered by getMatchesForEvent).
    let matchedUserIds: Set<string> | null = null
    if (eventIdFilter) {
      const rows = await getMatchesForEvent(eventIdFilter)
      matchedUserIds = new Set(rows.map((r) => r.user_id))
    }

    // For each user, count future events within range of their location.
    // 53 users × 21 events ≈ 1k cheap distance calcs — fine to do inline.
    const geocodedEvents = futureEvents.filter(
      (e): e is typeof e & { lat: number; lng: number } =>
        typeof e.lat === 'number' && typeof e.lng === 'number',
    )
    const nearbyByUserId = new Map<string, number>()
    for (const u of activeUsers) {
      if (typeof u.lat !== 'number' || typeof u.lng !== 'number') {
        nearbyByUserId.set(u.id, 0)
        continue
      }
      const userPoint = { lat: u.lat, lng: u.lng }
      let n = 0
      for (const e of geocodedEvents) {
        if (withinMiles(userPoint, { lat: e.lat, lng: e.lng }, NEARBY_RADIUS_MILES)) n++
      }
      nearbyByUserId.set(u.id, n)
    }

    const users = activeUsers
      .filter((u) => u.email)
      .filter((u) => !matchedUserIds || matchedUserIds.has(u.id))
      .map((u) => {
        const c = contribStats.get(u.id)
        const matchCount = counts.get(u.id) ?? 0
        const nearbyCount = nearbyByUserId.get(u.id) ?? 0
        const localMatchPct = nearbyCount > 0
          ? Math.round((matchCount / nearbyCount) * 100)
          : null
        const ratings = ratingCounts.get(u.id) ?? { going: 0, cantMakeIt: 0, notAFit: 0 }
        return {
          id: u.id,
          created: u.created || null,
          email: u.email,
          name: u.name,
          firstName: u.firstName,
          location: u.location,
          frequency: u.frequency,
          grade: u.grade ?? null,
          status: u.status || 'Pending',
          isHost: hostIds.has(u.id),
          // Fields used by the "To Approve" column set. Cheap to include
          // unconditionally; payload bump is a few hundred bytes per user.
          function: u.function || '',
          seniority: u.seniority || '',
          employment: u.employment || '',
          companySize: u.companySize || '',
          interest: u.interest || '',
          linkedin: u.linkedin || '',
          learn: u.learn || '',
          lat: typeof u.lat === 'number' ? u.lat : null,
          lng: typeof u.lng === 'number' ? u.lng : null,
          matchCount,
          nearbyEventCount: nearbyCount,
          localMatchPct,
          totalContributions: c?.total ?? 0,
          lastContribution: c?.lastAt ?? null,
          lastSeen: lastSeen.get(u.id) ?? null,
          lastDigestSent: lastDigest.get(u.id) ?? null,
          lastBlastSent: lastBlast.get(u.id) ?? null,
          ratingsGoing: ratings.going,
          ratingsCantMakeIt: ratings.cantMakeIt,
          ratingsNotAFit: ratings.notAFit,
        }
      })
      .sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount
        const an = (a.name || a.email).toLowerCase()
        const bn = (b.name || b.email).toLowerCase()
        return an.localeCompare(bn)
      })

    // Lightweight events list for the matched-event picklist on the
    // admin page. Sorted by date asc so the dropdown reads naturally.
    const events = [...futureEvents]
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map((e) => ({ id: e.id, name: e.name, date: e.date }))

    return NextResponse.json({
      users,
      events,
      stats: {
        // Name kept for client backwards compat; the count now reflects the
        // active statusBucket rather than always being "active users".
        activeUserCount: users.length,
        futureEventCount: futureEvents.length,
        statusBucket,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/dashboard-counts error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
