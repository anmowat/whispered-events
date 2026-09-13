import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import {
  verifySession,
  listShareContacts,
  addShareContact,
  removeShareContact,
  markShareContactInvited,
  getInterestedEventIdsByUser,
  countRecentInvites,
  MAX_INVITES_PER_DAY,
  type ShareContactRow,
} from '@/lib/supabase'
import { getUserByEmail, getUserById } from '@/lib/users'
import { getFutureEventsByIds } from '@/lib/events'
import { sendShareInviteEmail } from '@/lib/email'
import { notifyInviteThrottle, notifyEventShare } from '@/lib/slack'
import { absoluteLinkedin } from '@/lib/url'
import { toFindable, toShareVisibility } from '@/lib/types'

// Contacts a member shares their attending events with.
//   GET    -> { contacts, sharing, findable, shareVisibility }
//   POST   -> { email } | { userId }   add (idempotent; invites non-members once)
//   DELETE -> { id }                   soft-remove by contact row id
//
// Every handler is session-gated and scoped to the caller's own user id, so a
// member can only ever read or edit their own contact list.

async function requireSession(req: NextRequest) {
  const token = req.cookies.get('session')?.value
  if (!token) return null
  return verifySession(token)
}

// Deliberately permissive: enough to catch a typo or a pasted name, not a
// full RFC validator. A wrong-but-plausible address just means an invite that
// bounces, which Resend reports.
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

/**
 * Shape each contact for the client.
 *
 * The email is returned ONLY for contacts the owner added by typing an address
 * - they already know it. A contact added by picking a name from search comes
 * back as name + LinkedIn with `email: null`, because the owner has never seen
 * their address and must not learn it here. Without that rule the picker would
 * be an email-harvesting tool: search a name, add, read the address back.
 *
 * Every contact carries its row `id`, which is what the client uses to remove
 * one - so it never needs an address it isn't allowed to see.
 */
async function decorate(rows: ShareContactRow[]) {
  const users = await Promise.all(rows.map((r) => getUserByEmail(r.contactEmail)))
  return rows.map((r, i) => {
    const u = users[i]
    const name = u ? u.name || u.firstName || '' : ''
    return {
      id: r.id,
      name: name === 'DEFAULT' ? '' : name,
      linkedin: u ? absoluteLinkedin(u.linkedin) : '',
      isMember: !!u,
      email: r.addedVia === 'email' ? r.contactEmail : null,
      followed: r.addedVia === 'follow',
    }
  })
}

/** The events that will actually be shared: the caller's own 'interested'
 *  ratings on future Live events. Surfaced in the share modal because with
 *  Interested doubling as the attending signal, a member otherwise has no way
 *  to see what they're broadcasting. */
async function sharingEvents(userId: string) {
  const byUser = await getInterestedEventIdsByUser([userId])
  const events = await getFutureEventsByIds(byUser.get(userId) ?? [])
  return events
    .map((e) => ({ id: e.id, name: e.name, date: e.date }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}

/** One response shape for every handler, so the modal re-hydrates fully after
 *  any mutation rather than patching pieces of its own state. */
async function currentState(userId: string, email: string) {
  const [rows, sharing, me] = await Promise.all([
    listShareContacts(userId),
    sharingEvents(userId),
    getUserByEmail(email),
  ])
  return {
    contacts: await decorate(rows),
    sharing,
    findable: toFindable(me?.findable),
    shareVisibility: toShareVisibility(me?.shareVisibility),
  }
}

export async function GET(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await currentState(session.userId, session.email))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/contacts GET error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { email?: unknown; userId?: unknown }
  const rawUserId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  // Resolve whichever identifier was sent into the address we store. On the
  // userId path the address is looked up server-side and never returned, which
  // is what lets a member share with someone whose email they don't know.
  let email = ''
  let addedVia: 'email' | 'member' = 'email'
  if (rawUserId) {
    const target = await getUserById(rawUserId)
    if (!target || !target.active || !target.email) {
      return NextResponse.json({ error: 'That member could not be found.' }, { status: 400 })
    }
    email = target.email.trim().toLowerCase()
    addedVia = 'member'
  } else {
    if (!rawEmail || !looksLikeEmail(rawEmail)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    }
    email = rawEmail
  }

  if (email === session.email.trim().toLowerCase()) {
    return NextResponse.json(
      { error: "That's you - you already see your own events." },
      { status: 400 },
    )
  }

  try {
    // No ceiling on the contact list itself - share with as many people as you
    // like. Sharing with an existing member sends no mail at all, so there is
    // nothing to rate-limit there.
    const { contact, created } = await addShareContact(session.userId, email, addedVia)

    if (created) {
      const sharer = await getUserByEmail(session.email)
      waitUntil(
        notifyEventShare({
          ownerUserId: session.userId,
          ownerName: sharer?.name,
          ownerEmail: session.email,
          ownerLinkedin: sharer?.linkedin,
          contactEmail: email,
          method: addedVia,
          source: 'dashboard',
        }).catch((e) => console.error('dashboard/contacts: notifyEventShare failed', e)),
      )
    }

    // Members already on Whispered are told in their next digest, so nothing
    // is sent here. Non-members get one invite, ever - invited_at survives a
    // remove/re-add so repeatedly toggling a contact can't be used to mail
    // someone over and over.
    //
    // The name-search path can never reach this branch: search only returns
    // members, and a member never gets an invite.
    const contactUser = await getUserByEmail(email)
    if (created && !contactUser && !contact.invitedAt) {
      // Daily invite throttle. The contact is saved either way and still sees
      // the events once they join - only the notification mail is held back,
      // so hitting this never costs anyone a share.
      const recentInvites = await countRecentInvites(session.userId)
      const me = await getUserByEmail(session.email)
      if (recentInvites >= MAX_INVITES_PER_DAY) {
        console.warn('dashboard/contacts: daily invite limit reached, invite not sent', {
          userId: session.userId,
          recentInvites,
        })
        // Shout about it. A withheld invite is invisible on the monitor BCC -
        // it looks exactly like the member having stopped - so Slack is the
        // only place this surfaces.
        waitUntil(
          notifyInviteThrottle({
            userId: session.userId,
            email: session.email,
            name: me?.name,
            linkedin: me?.linkedin,
            recentInvites,
            limit: MAX_INVITES_PER_DAY,
            attemptedEmail: email,
          }).catch((e) => console.error('dashboard/contacts: notifyInviteThrottle failed', e)),
        )
      } else {
        waitUntil(
          sendShareInviteEmail({
            contactEmail: email,
            sharerName: me?.name ?? '',
            sharerFirstName: me?.firstName ?? '',
          })
            .then(() => markShareContactInvited(contact.id))
            .catch((e) => console.error('dashboard/contacts: sendShareInviteEmail failed', e)),
        )
      }
    }

    return NextResponse.json({
      ...(await currentState(session.userId, session.email)),
      added: created,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/contacts POST error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { id?: unknown }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    // removeShareContact scopes the update to the caller's own owner_user_id,
    // so a guessed id can't reach anyone else's contact list.
    await removeShareContact(session.userId, id)
    return NextResponse.json(await currentState(session.userId, session.email))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/contacts DELETE error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
