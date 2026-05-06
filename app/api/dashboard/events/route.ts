import { NextRequest, NextResponse } from 'next/server'
import { verifySession, getMatchedEventIds } from '@/lib/supabase'
import { getFutureEvents } from '@/lib/airtable'

// TESTING: returns all upcoming events regardless of match score. Pass
// ?matched=1 to restrict to events matched to the logged-in user
// (score > 0.75) once we're ready to enforce match filtering.
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

  const futureEvents = await getFutureEvents()
  let filtered = futureEvents
  if (matchedOnly) {
    const matchedIds = await getMatchedEventIds(email)
    filtered = futureEvents.filter((e) => matchedIds.has(e.id))
  }

  const events = filtered.sort((a, b) => a.date.localeCompare(b.date))
  return NextResponse.json({ events })
}
