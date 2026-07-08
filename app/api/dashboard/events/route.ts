import { NextRequest, NextResponse } from 'next/server'
import { verifySession, getMatchScoresForUser } from '@/lib/supabase'
import { getFutureEvents } from '@/lib/events'

const MATCH_PERCENT_THRESHOLD = 40

// Returns upcoming events where match_percent >= 40 for the logged-in user.
// Pass ?all=1 to bypass the filter (admin/debug).
export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value

  if (!sessionToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const session = await verifySession(sessionToken)

  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const showAll = req.nextUrl.searchParams.get('all') === '1'

  const [futureEvents, scores] = await Promise.all([
    getFutureEvents(),
    getMatchScoresForUser(session.userId),
  ])

  const withScores = futureEvents.map((e) => {
    const entry = scores.get(e.id)
    return {
      ...e,
      matchScore: entry?.score ?? null,
      matchPercent: entry?.matchPercent ?? null,
      rating: entry?.rating ?? null,
      ratingReason: entry?.ratingReason ?? null,
      hostRating: entry?.hostRating ?? null,
    }
  })

  // Hard hide thumbs-down: once a user or host rates a match `down`, it drops
  // off the user's dashboard. The matches row still carries the rating (admin
  // analytics + internal notification email still fire), but the user doesn't
  // see the event again on this page. ?all=1 bypasses both filters for
  // admin/debug viewing.
  const filtered = showAll
    ? withScores
    : withScores.filter(
        (e) =>
          (e.matchPercent ?? 0) >= MATCH_PERCENT_THRESHOLD &&
          e.rating !== 'down' &&
          e.hostRating !== 'down',
      )

  const events = filtered.sort((a, b) => a.date.localeCompare(b.date))
  return NextResponse.json({ events })
}
