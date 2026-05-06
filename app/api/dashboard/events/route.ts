import { NextRequest, NextResponse } from 'next/server'
import { verifySession, getMatchScoresForUser } from '@/lib/supabase'
import { getFutureEvents } from '@/lib/airtable'

// TESTING: returns all upcoming events regardless of match score. Pass
// ?matched=1 to restrict to events with score > 0.75 once we're ready to
// enforce match filtering.
export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value

  if (!sessionToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const email = await verifySession(sessionToken)

  if (!email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const matchedOnly = req.nextUrl.searchParams.get('matched') === '1'

  const [futureEvents, scores] = await Promise.all([
    getFutureEvents(),
    getMatchScoresForUser(email),
  ])

  const withScores = futureEvents.map((e) => ({
    ...e,
    matchScore: scores.get(e.id) ?? null,
  }))

  const filtered = matchedOnly
    ? withScores.filter((e) => (e.matchScore ?? 0) > 0.75)
    : withScores

  const events = filtered.sort((a, b) => a.date.localeCompare(b.date))
  return NextResponse.json({ events })
}
