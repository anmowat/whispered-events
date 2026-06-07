import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import {
  getMatchCountsByEmail,
  getContributionTotalsByEmail,
  getLastSeenByEmail,
  getLastDigestSentByEmail,
  getLastBlastSentByEmail,
} from '@/lib/supabase'
import { getActiveUsers, getFutureEvents } from '@/lib/airtable'
import { withinMiles } from '@/lib/geocode'

const NEARBY_RADIUS_MILES = 100

// Admin overview: each active user's id/name/email/location + match count for
// events on their dashboard + contribution totals + last-seen timestamp.
// Sub-second via bulk Supabase queries plus the 90s-cached Airtable reads.

export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const [activeUsers, futureEvents, contribStats, lastSeen, lastDigest, lastBlast] = await Promise.all([
      getActiveUsers(),
      getFutureEvents(),
      getContributionTotalsByEmail(),
      getLastSeenByEmail(),
      getLastDigestSentByEmail(),
      getLastBlastSentByEmail(),
    ])
    const futureEventIds = futureEvents.map((e) => e.id)
    const counts = await getMatchCountsByEmail(futureEventIds)

    // For each user, count future events within 100mi of their location.
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
      .map((u) => {
        const key = u.email.trim().toLowerCase()
        const c = contribStats.get(key)
        const matchCount = counts.get(u.email) ?? 0
        const nearbyCount = nearbyByUserId.get(u.id) ?? 0
        const localMatchPct = nearbyCount > 0
          ? Math.round((matchCount / nearbyCount) * 100)
          : null
        return {
          id: u.id,
          created: u.created || null,
          email: u.email,
          name: u.name,
          firstName: u.firstName,
          location: u.location,
          frequency: u.frequency,
          matchCount,
          nearbyEventCount: nearbyCount,
          localMatchPct,
          totalContributions: c?.total ?? 0,
          lastContribution: c?.lastAt ?? null,
          lastSeen: lastSeen.get(key) ?? null,
          lastDigestSent: lastDigest.get(key) ?? null,
          lastBlastSent: lastBlast.get(key) ?? null,
        }
      })
      .sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount
        const an = (a.name || a.email).toLowerCase()
        const bn = (b.name || b.email).toLowerCase()
        return an.localeCompare(bn)
      })

    return NextResponse.json({
      users,
      stats: {
        activeUserCount: users.length,
        futureEventCount: futureEvents.length,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/dashboard-counts error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
