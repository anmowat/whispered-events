import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { addShareContact, listShareContacts } from '@/lib/supabase'
import { getUserById } from '@/lib/users'
import { verifySignupToken } from '@/lib/signup-token'
import { notifyEventShare } from '@/lib/slack'

// Add event-sharing contacts from the signup finish screen.
//
// There is no session at this point - the member is status Pending and the
// magic-link endpoint refuses inactive users - so authorisation comes from the
// short-lived HMAC token minted by /api/submit-profile. Without it, an
// endpoint taking a user id would let anyone write contacts onto any account.
//
// NOTHING IS EMAILED HERE. Rows land with invited_at null and the invites go
// out from triggerUserApprovedFlow once the member is approved. Otherwise
// anyone who filled in the signup form could make our domain mail strangers
// before being vetted.

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

// Matches the dashboard's per-member ceiling. A pending applicant should not
// get a larger allowance than an approved member.
const MAX_AT_SIGNUP = 50

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown; email?: unknown }
  const token = typeof body.token === 'string' ? body.token : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  const userId = verifySignupToken(token)
  if (!userId) {
    return NextResponse.json({ error: 'This signup session has expired.' }, { status: 401 })
  }
  if (!email || !looksLikeEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  try {
    const owner = await getUserById(userId)
    if (!owner || !owner.email) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 400 })
    }
    if (email === owner.email.trim().toLowerCase()) {
      return NextResponse.json(
        { error: "That's your own address - you already see your events." },
        { status: 400 },
      )
    }

    const existing = await listShareContacts(userId)
    if (existing.length >= MAX_AT_SIGNUP && !existing.some((c) => c.contactEmail === email)) {
      return NextResponse.json({ error: 'That is a lot of contacts - add the rest from your dashboard.' }, { status: 400 })
    }

    const { created } = await addShareContact(userId, email, 'email')

    if (created) {
      waitUntil(
        notifyEventShare({
          ownerUserId: userId,
          ownerName: owner.name,
          ownerEmail: owner.email,
          ownerLinkedin: owner.linkedin,
          contactEmail: email,
          method: 'email',
          source: 'signup',
        }).catch((e) => console.error('signup/contacts: notifyEventShare failed', e)),
      )
    }

    const rows = await listShareContacts(userId)
    return NextResponse.json({ contacts: rows.map((r) => r.contactEmail) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('signup/contacts error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown; email?: unknown }
  const token = typeof body.token === 'string' ? body.token : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  const userId = verifySignupToken(token)
  if (!userId) {
    return NextResponse.json({ error: 'This signup session has expired.' }, { status: 401 })
  }
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  try {
    // By email rather than row id here: the signup screen only ever holds
    // addresses the person typed themselves, so there is nothing to hide, and
    // the ownerUserId from the token scopes the delete.
    const rows = await listShareContacts(userId)
    const match = rows.find((r) => r.contactEmail === email)
    if (match) {
      const { removeShareContact } = await import('@/lib/supabase')
      await removeShareContact(userId, match.id)
    }
    const after = await listShareContacts(userId)
    return NextResponse.json({ contacts: after.map((r) => r.contactEmail) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('signup/contacts DELETE error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
