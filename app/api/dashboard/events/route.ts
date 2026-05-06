import { NextRequest, NextResponse } from 'next/server'
import { verifySession, getMatchScoresForUser } from '@/lib/supabase'
import { getFutureEvents } from '@/lib/airtable'

const NOTIFY_THRESHOLD = 1.0

// TESTING: returns all upcoming events regardless of match score. Pass
// ?matched=1 to restrict to events with score >= 1.0 once we're ready to
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

  const withScores = futureEvents.map((e) => {
    const entry = scores.get(e.id)
    return {
      ...e,
      matchScore: entry?.score ?? null,
      matchPercent: entry?.matchPercent ?? null,
    }
  })

  const filtered = matchedOnly
    ? withScores.filter((e) => (e.matchScore ?? 0) >= NOTIFY_THRESHOLD)
    : withScores

  const events = filtered.sort((a, b) => a.date.localeCompare(b.date))
  return NextResponse.json({ events })
}
