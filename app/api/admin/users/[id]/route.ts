import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { getUserById, getFutureEvents } from '@/lib/airtable'
import { getAllMatchesForUser, getContributionStats, getLastSeenForEmail } from '@/lib/supabase'

// Admin user detail: returns the user's profile fields plus every future
// event scored against them, sorted by match % desc, with per-pair score
// breakdown for tooltip display.

export const maxDuration = 60

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const userId = params.id
  if (!userId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  try {
    const user = await getUserById(userId)
    if (!user) {
      return NextResponse.json({ error: 'user not found' }, { status: 404 })
    }

    const [futureEvents, matchRows, contributions, lastSeen] = await Promise.all([
      getFutureEvents(),
      getAllMatchesForUser(user.email),
      getContributionStats(user.email),
      getLastSeenForEmail(user.email),
    ])

    const byEventId = new Map(matchRows.map((m) => [m.event_id, m]))

    // Build one row per future event. Events with no match row get null
    // scores and fall to the bottom of the sort.
    const events = futureEvents
      .map((e) => {
        const m = byEventId.get(e.id)
        return {
          id: e.id,
          name: e.name,
          type: e.type,
          date: e.date,
          location: e.location,
          audience: e.audience,
          link: e.link,
          score: m?.score ?? null,
          matchPercent: m?.match_percent ?? null,
          locationScore: m?.location_score ?? null,
          audienceScore: m?.audience_score ?? null,
          qualityScore: m?.quality_score ?? null,
          preferenceScore: m?.preference_score ?? null,
          skippedReason: m?.skipped_reason ?? null,
        }
      })
      .sort((a, b) => {
        // Scored events first (sorted by match% desc), unscored at the bottom.
        const ap = a.matchPercent
        const bp = b.matchPercent
        if (ap === null && bp === null) return a.date.localeCompare(b.date)
        if (ap === null) return 1
        if (bp === null) return -1
        if (bp !== ap) return bp - ap
        return a.date.localeCompare(b.date)
      })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        function: user.function,
        seniority: user.seniority,
        linkedin: user.linkedin,
        fullExp: user.fullExp,
        grade: user.grade ?? '',
        interest: user.interest,
        learn: user.learn,
        employment: user.employment,
        companySize: user.companySize,
        location: user.location,
        lat: user.lat ?? null,
        lng: user.lng ?? null,
        active: user.active,
        status: user.status,
        frequency: user.frequency,
        // Contribution stats now sourced from Supabase `contributions` table.
        lastContribution: contributions.lastAt,
        totalContributions: contributions.total,
        contributionsLast30: contributions.last30,
        contributionsLast90: contributions.last90,
        lastSeen,
      },
      events,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/users/[id] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
