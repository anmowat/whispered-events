import { NextRequest, NextResponse } from 'next/server'
import { verifySession, listSharersFor, getInterestedEventIdsByUser } from '@/lib/supabase'
import { getUsersByIds } from '@/lib/users'
import { getFutureEventsByIds } from '@/lib/events'

// Events the caller's contacts are attending.
//
// "Attending" is the 'interested' rating. This route deliberately applies NO
// match filtering of its own: you see whatever a contact is going to, whether
// or not you match it, whether or not it cleared your own threshold. That is
// the point of the feature - the matching gates in
// app/api/dashboard/events/route.ts answer a different question.

export async function GET(req: NextRequest) {
  const token = req.cookies.get('session')?.value
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    // Who shares with me, resolved from my email rather than my id - that is
    // what lets a share made before I joined light up the moment I do.
    const sharers = await listSharersFor(session.email)
    const ownerIds = Array.from(new Set(sharers.map((s) => s.ownerUserId)))
    if (ownerIds.length === 0) {
      return NextResponse.json({ events: [], contacts: [] })
    }

    const [owners, interestedByUser] = await Promise.all([
      getUsersByIds(ownerIds),
      getInterestedEventIdsByUser(ownerIds),
    ])

    // Only active members share. A deactivated or removed account should stop
    // broadcasting even though its contact rows still exist.
    const ownerById = new Map(owners.filter((u) => u.active).map((u) => [u.id, u]))

    const allEventIds = new Set<string>()
    Array.from(interestedByUser.entries()).forEach(([userId, eventIds]) => {
      if (!ownerById.has(userId)) return
      eventIds.forEach((id) => allEventIds.add(id))
    })

    const events = await getFutureEventsByIds(Array.from(allEventIds))
    const eventById = new Map(events.map((e) => [e.id, e]))

    // event id -> the contacts attending it
    const attendeesByEvent = new Map<string, Array<{ name: string; email: string }>>()
    Array.from(interestedByUser.entries()).forEach(([userId, eventIds]) => {
      const owner = ownerById.get(userId)
      if (!owner) return
      const label = owner.name || owner.firstName || owner.email
      eventIds.forEach((eventId) => {
        if (!eventById.has(eventId)) return
        const list = attendeesByEvent.get(eventId)
        const entry = { name: label, email: owner.email }
        if (list) list.push(entry)
        else attendeesByEvent.set(eventId, [entry])
      })
    })

    const payload = events
      .filter((e) => (attendeesByEvent.get(e.id) ?? []).length > 0)
      .map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        link: e.link,
        date: e.date,
        type: e.type,
        location: e.location,
        attendees: (attendeesByEvent.get(e.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    // The filter dropdown lists every contact sharing with me, including ones
    // with nothing coming up - otherwise the list silently changes shape.
    const contacts = Array.from(ownerById.values())
      .map((u) => ({ name: u.name || u.firstName || u.email, email: u.email }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ events: payload, contacts })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/contact-events error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
