import { NextRequest, NextResponse } from 'next/server'
import { verifySession, listSharersFor, getInterestedEventIdsByUser } from '@/lib/supabase'
import { getUsersByIds, getUserByEmail } from '@/lib/users'
import { getFutureEventsByIds } from '@/lib/events'
import { absoluteLinkedin } from '@/lib/url'
import { toFindable, toShareVisibility } from '@/lib/types'

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
    // A member set to 'none' has opted out of receiving. Rows are still being
    // written for them - we never fail the sharer's action - but nothing is
    // shown until they switch back, at which point the whole backlog appears.
    // That is why the dashboard row reads "Activate" rather than "View".
    const me = await getUserByEmail(session.email)
    if (toFindable(me?.findable) === 'none') {
      return NextResponse.json({ events: [], contacts: [], inactive: true })
    }

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
    //
    // Follow rows get a second check. A follow was authorised by the owner
    // being set to 'everyone' at the time; if they have since switched back to
    // 'contacts' that access must end. Re-reading the owner's CURRENT setting
    // rather than trusting the row is what makes the switch a real revocation
    // for every follower at once.
    const followOwnerIds = new Set(
      sharers.filter((r) => r.addedVia === 'follow').map((r) => r.ownerUserId),
    )
    const deliberateOwnerIds = new Set(
      sharers.filter((r) => r.addedVia !== 'follow').map((r) => r.ownerUserId),
    )
    const ownerById = new Map(
      owners
        .filter((u) => u.active)
        .filter(
          (u) =>
            deliberateOwnerIds.has(u.id) ||
            (followOwnerIds.has(u.id) && toShareVisibility(u.shareVisibility) === 'everyone'),
        )
        .map((u) => [u.id, u]),
    )

    const allEventIds = new Set<string>()
    Array.from(interestedByUser.entries()).forEach(([userId, eventIds]) => {
      if (!ownerById.has(userId)) return
      eventIds.forEach((id) => allEventIds.add(id))
    })

    const events = await getFutureEventsByIds(Array.from(allEventIds))
    const eventById = new Map(events.map((e) => [e.id, e]))

    // event id -> the contacts attending it. Keyed on userId, NOT email: these
    // are people who shared with you, and you may never have known their
    // address. Same rule as the contact list - name and LinkedIn, no email.
    const attendeesByEvent = new Map<
      string,
      Array<{ userId: string; name: string; linkedin: string }>
    >()
    Array.from(interestedByUser.entries()).forEach(([userId, eventIds]) => {
      const owner = ownerById.get(userId)
      if (!owner) return
      // 'DEFAULT' is the no-name sentinel. No email fallback, not even the
      // local part - the rule for this surface is name and LinkedIn only.
      const raw = owner.name || owner.firstName || ''
      const label = raw && raw !== 'DEFAULT' ? raw : 'A Whispered member'
      eventIds.forEach((eventId) => {
        if (!eventById.has(eventId)) return
        const list = attendeesByEvent.get(eventId)
        const entry = {
          userId: owner.id,
          name: label,
          linkedin: absoluteLinkedin(owner.linkedin),
        }
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
      .map((u) => {
        const raw = u.name || u.firstName || ''
        return {
          userId: u.id,
          name: raw && raw !== 'DEFAULT' ? raw : 'A Whispered member',
          linkedin: absoluteLinkedin(u.linkedin),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ events: payload, contacts })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/contact-events error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
