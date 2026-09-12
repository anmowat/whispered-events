import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/supabase'
import { getUserByEmail } from '@/lib/users'
import { getContactAttendance } from '@/lib/contact-attendance'

// How many of the caller's contacts are attending ONE event.
//
// Powers the /rate thanks page, which is the highest-intent moment in the
// product - someone has just said they're going. Returns names as well as a
// count, because at that moment "who?" is the obvious next question.
//
// Never an email address, and every privacy rule comes from the shared reader.

export async function GET(req: NextRequest) {
  const token = req.cookies.get('session')?.value
  if (!token) return NextResponse.json({ count: 0, names: [] })
  const session = await verifySession(token)
  if (!session) return NextResponse.json({ count: 0, names: [] })

  const eventId = (req.nextUrl.searchParams.get('eventId') || '').trim()
  if (!eventId) return NextResponse.json({ count: 0, names: [] })

  try {
    const me = await getUserByEmail(session.email)
    const attendance = await getContactAttendance(session.email, me?.findable)
    const attendees = attendance.byEvent.get(eventId) ?? []
    return NextResponse.json({
      count: attendees.length,
      names: attendees.map((a) => a.name),
    })
  } catch (err) {
    // Soft signal: degrade to showing nothing rather than erroring a page
    // whose actual job (recording the rating) already succeeded.
    console.error('dashboard/event-attendance error:', err)
    return NextResponse.json({ count: 0, names: [] })
  }
}
