import { NextRequest, NextResponse } from 'next/server'
import { verifySession, getMatchedEventIds } from '@/lib/supabase'
import { getFutureEvents } from '@/lib/airtable'

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value

  if (!sessionToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const email = await verifySession(sessionToken)

  if (!email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const [matchedIds, futureEvents] = await Promise.all([
    getMatchedEventIds(email),
    getFutureEvents(),
  ])

  const events = futureEvents
    .filter((e) => matchedIds.has(e.id))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({ events })
}
