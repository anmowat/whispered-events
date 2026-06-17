import { NextRequest, NextResponse } from 'next/server'
import { verifySession, getMatchScoresForUser } from '@/lib/supabase'
import { getFutureEvents } from '@/lib/airtable'

const NOTIFY_THRESHOLD = 1.35

// Returns upcoming events that have a persisted match score >= NOTIFY_THRESHOLD
// for the logged-in user. Pass ?all=1 to bypass the filter (admin/debug).
export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value

  if (!sessionToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const email = await verifySession(sessionToken)

  if (!email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const showAll = req.nextUrl.searchParams.get('all') === '1'

  const [futureEvents, scores] = await Promise.all([
    getFutureEvents(),
    getMatchScoresForUser(email),
  ])

  const withScores = futureEvents.map((e) => {
    const entry = scores.get(e.id)
    return {
      ...e,
      matchScore: entry?.score ?? null,
      matchPercent: entry?.matchPercent ?? null,
      rating: entry?.rating ?? null,
      ratingReason: entry?.ratingReason ?? null,
    }
  })

  const filtered = showAll
    ? withScores
    : withScores.filter((e) => (e.matchScore ?? 0) >= NOTIFY_THRESHOLD)

  const events = filtered.sort((a, b) => a.date.localeCompare(b.date))
  return NextResponse.json({ events })
}
