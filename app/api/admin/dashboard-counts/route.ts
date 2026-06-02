import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import {
  getMatchCountsByEmail,
  getContributionTotalsByEmail,
  getLastSeenByEmail,
  getLastEmailSentByEmail,
} from '@/lib/supabase'
import { getActiveUsers, getFutureEvents } from '@/lib/airtable'

// Admin overview: each active user's id/name/email/location + match count for
// events on their dashboard + contribution totals + last-seen timestamp.
// Sub-second via bulk Supabase queries plus the 90s-cached Airtable reads.

export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const [activeUsers, futureEvents, contribStats, lastSeen, lastEmail] = await Promise.all([
      getActiveUsers(),
      getFutureEvents(),
      getContributionTotalsByEmail(),
      getLastSeenByEmail(),
      getLastEmailSentByEmail(),
    ])
    const futureEventIds = futureEvents.map((e) => e.id)
    const counts = await getMatchCountsByEmail(futureEventIds)

    const users = activeUsers
      .filter((u) => u.email)
      .map((u) => {
        const key = u.email.trim().toLowerCase()
        const c = contribStats.get(key)
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          firstName: u.firstName,
          location: u.location,
          frequency: u.frequency,
          matchCount: counts.get(u.email) ?? 0,
          totalContributions: c?.total ?? 0,
          lastContribution: c?.lastAt ?? null,
          lastSeen: lastSeen.get(key) ?? null,
          lastEmailSent: lastEmail.get(key) ?? null,
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
