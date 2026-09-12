import { listSharersFor, getInterestedEventIdsByUser } from './supabase'
import { getUsersByIds } from './users'
import { getFutureEventsByIds, type AirtableEvent } from './events'
import { absoluteLinkedin } from './url'
import { toFindable, toShareVisibility } from './types'

/**
 * Who among a viewer's contacts is attending what.
 *
 * This module exists because deciding whether one member may see that another
 * is attending something is a PRIVACY rule with several callers - the View
 * Events modal, the dashboard cards, the digest, the post-rating surfaces. It
 * lives here once. Reimplementing any part of it at a call site is how one copy
 * gets updated and the others quietly keep leaking.
 *
 * Three rules, all enforced below and nowhere else:
 *
 *   1. A viewer set to findable='none' has opted out of receiving. Rows are
 *      still written for them so a sharer's action never fails, but they see
 *      nothing until they switch back.
 *   2. Only ACTIVE members broadcast. A deactivated account stops sharing even
 *      though its contact rows survive.
 *   3. A follow row is not authority on its own. It was authorised by the owner
 *      being set to share_visibility='everyone' at the time; that is re-read
 *      here on every call, so switching back to 'contacts' revokes every
 *      follower at once.
 *
 * Never returns an email address. Name and LinkedIn only, matching every other
 * member-to-member surface.
 */

export interface ContactAttendee {
  userId: string
  name: string
  linkedin: string
}

export interface ContactAttendance {
  /** Viewer has opted out of receiving; every surface should show nothing. */
  inactive: boolean
  /** event id -> the viewer's contacts attending it. */
  byEvent: Map<string, ContactAttendee[]>
  /** Every contact currently sharing with the viewer, including those with
   *  nothing coming up - the filter list would otherwise change shape. */
  contacts: ContactAttendee[]
  /** The future, Live events any of them are attending. */
  events: AirtableEvent[]
}

const EMPTY: ContactAttendance = {
  inactive: false,
  byEvent: new Map(),
  contacts: [],
  events: [],
}

/** 'DEFAULT' is the project's sentinel for "no real name on file". Falls back
 *  to a generic label rather than an address - the rule for these surfaces is
 *  name and LinkedIn only. */
function displayName(user: { name?: string; firstName?: string }): string {
  const raw = user.name || user.firstName || ''
  return raw && raw !== 'DEFAULT' ? raw : 'A Whispered member'
}

export async function getContactAttendance(
  viewerEmail: string,
  viewerFindable?: string,
): Promise<ContactAttendance> {
  if (toFindable(viewerFindable) === 'none') {
    return { ...EMPTY, inactive: true, byEvent: new Map() }
  }

  // Resolved from the viewer's EMAIL rather than their id, which is what lets
  // a share made before they joined light up the moment they do.
  const sharers = await listSharersFor(viewerEmail)
  const ownerIds = Array.from(new Set(sharers.map((s) => s.ownerUserId)))
  // The common case by far: nobody shares with this member, so we stop after
  // one indexed query rather than doing the full fan-out.
  if (ownerIds.length === 0) return { ...EMPTY, byEvent: new Map() }

  const [owners, interestedByUser] = await Promise.all([
    getUsersByIds(ownerIds),
    getInterestedEventIdsByUser(ownerIds),
  ])

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
  const eventIds = new Set(events.map((e) => e.id))

  const byEvent = new Map<string, ContactAttendee[]>()
  Array.from(interestedByUser.entries()).forEach(([userId, ids]) => {
    const owner = ownerById.get(userId)
    if (!owner) return
    const entry: ContactAttendee = {
      userId: owner.id,
      name: displayName(owner),
      linkedin: absoluteLinkedin(owner.linkedin),
    }
    ids.forEach((eventId) => {
      if (!eventIds.has(eventId)) return
      const list = byEvent.get(eventId)
      if (list) list.push(entry)
      else byEvent.set(eventId, [entry])
    })
  })

  Array.from(byEvent.values()).forEach((list) =>
    list.sort((a, b) => a.name.localeCompare(b.name)),
  )

  const contacts = Array.from(ownerById.values())
    .map((u) => ({
      userId: u.id,
      name: displayName(u),
      linkedin: absoluteLinkedin(u.linkedin),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { inactive: false, byEvent, contacts, events }
}

/** event id -> count, for surfaces that show a number rather than names. */
export function attendanceCounts(a: ContactAttendance): Map<string, number> {
  const counts = new Map<string, number>()
  Array.from(a.byEvent.entries()).forEach(([eventId, list]) => {
    counts.set(eventId, list.length)
  })
  return counts
}
