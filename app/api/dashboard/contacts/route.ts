import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import {
  verifySession,
  listShareContacts,
  addShareContact,
  removeShareContact,
  markShareContactInvited,
  getInterestedEventIdsByUser,
  MAX_SHARE_CONTACTS,
} from '@/lib/supabase'
import { getUserByEmail } from '@/lib/users'
import { getFutureEventsByIds } from '@/lib/events'
import { sendShareInviteEmail } from '@/lib/email'

// Contacts a member shares their attending events with.
//   GET    -> { contacts: [{ email, name, isMember }], max }
//   POST   -> { email }  add (idempotent; invites non-members once)
//   DELETE -> { email }  soft-remove
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

/** Resolve each contact email to an active member, so the UI can say whether
 *  they'll see events now or still need to accept an invite. */
async function decorate(emails: string[]) {
  const users = await Promise.all(emails.map((e) => getUserByEmail(e)))
  return emails.map((email, i) => {
    const u = users[i]
    return {
      email,
      name: u ? u.name || u.firstName || '' : '',
      isMember: !!u,
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

export async function GET(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const [rows, sharing] = await Promise.all([
      listShareContacts(session.userId),
      sharingEvents(session.userId),
    ])
    return NextResponse.json({
      contacts: await decorate(rows.map((r) => r.contactEmail)),
      sharing,
      max: MAX_SHARE_CONTACTS,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/contacts GET error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { email?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !looksLikeEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }
  if (email === session.email.trim().toLowerCase()) {
    return NextResponse.json(
      { error: "That's your own address - you already see your events." },
      { status: 400 },
    )
  }

  try {
    const existing = await listShareContacts(session.userId)
    const alreadyThere = existing.some((c) => c.contactEmail === email)
    // Cap the list before inserting. This endpoint sends mail to arbitrary
    // member-supplied addresses, so the ceiling is a spam control, not tidiness.
    if (!alreadyThere && existing.length >= MAX_SHARE_CONTACTS) {
      return NextResponse.json(
        { error: `You can share with up to ${MAX_SHARE_CONTACTS} contacts.` },
        { status: 400 },
      )
    }

    const { contact, created } = await addShareContact(session.userId, email)

    // Members already on Whispered are told in their next digest, so nothing
    // is sent here. Non-members get one invite, ever - invited_at survives a
    // remove/re-add so repeatedly toggling a contact can't be used to mail
    // someone over and over.
    const contactUser = await getUserByEmail(email)
    if (created && !contactUser && !contact.invitedAt) {
      const me = await getUserByEmail(session.email)
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

    const rows = await listShareContacts(session.userId)
    return NextResponse.json({
      contacts: await decorate(rows.map((r) => r.contactEmail)),
      sharing: await sharingEvents(session.userId),
      max: MAX_SHARE_CONTACTS,
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

  const body = (await req.json().catch(() => ({}))) as { email?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  try {
    await removeShareContact(session.userId, email)
    const rows = await listShareContacts(session.userId)
    return NextResponse.json({
      contacts: await decorate(rows.map((r) => r.contactEmail)),
      sharing: await sharingEvents(session.userId),
      max: MAX_SHARE_CONTACTS,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/contacts DELETE error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
