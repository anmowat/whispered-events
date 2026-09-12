import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/supabase'
import { getUserByEmail } from '@/lib/users'
import { getContactAttendance } from '@/lib/contact-attendance'

// Events the caller's contacts are attending.
//
// "Attending" is the 'interested' rating. No match filtering is applied: you
// see whatever a contact is going to, whether or not you match it, whether or
// not it cleared your own threshold. That is the point of the feature - the
// matching gates in app/api/dashboard/events/route.ts answer a different
// question.
//
// All the privacy rules (opted-out viewers, inactive sharers, follow
// revocation) live in lib/contact-attendance.ts, shared with every other
// surface that shows this. This route only shapes the response.

export async function GET(req: NextRequest) {
  const token = req.cookies.get('session')?.value
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const me = await getUserByEmail(session.email)
    const attendance = await getContactAttendance(session.email, me?.findable)
    if (attendance.inactive) {
      return NextResponse.json({ events: [], contacts: [], inactive: true })
    }

    const payload = attendance.events
      .filter((e) => (attendance.byEvent.get(e.id) ?? []).length > 0)
      .map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        link: e.link,
        date: e.date,
        type: e.type,
        location: e.location,
        attendees: attendance.byEvent.get(e.id) ?? [],
      }))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    return NextResponse.json({ events: payload, contacts: attendance.contacts })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/contact-events error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
