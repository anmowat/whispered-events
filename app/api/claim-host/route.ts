import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { addEventHost, getPartnerUserByEmail } from '@/lib/airtable'

// Partner-only "claim me as a host" mutation. Used by the contribute flow
// when /api/check-event flagged the submitter as eligible to claim
// (duplicate event with no host, or partner adding themselves as a co-host
// on an event that already has a different host).
//
// Trust model: we re-verify Partner status server-side via Airtable so a
// fabricated request from a non-partner gets 403'd regardless of what the
// client claims. Admins still review newly-added hosts manually (the
// Status='Partner' filter is the trust gate).

export const maxDuration = 30

export async function POST(req: NextRequest) {
  let body: { eventId?: string; email?: string }
  try {
    body = (await req.json()) as { eventId?: string; email?: string }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const eventId = body.eventId?.trim()
  const email = body.email?.trim().toLowerCase()
  if (!eventId || !email) {
    return NextResponse.json({ error: 'eventId and email are required' }, { status: 400 })
  }

  // Server-side partner check — never trust the caller.
  const partner = await getPartnerUserByEmail(email)
  if (!partner) {
    return NextResponse.json({ error: 'not a partner' }, { status: 403 })
  }

  try {
    await addEventHost(eventId, partner.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('claim-host: addEventHost failed', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Re-run matching so anything host-aware refreshes. waitUntil keeps the
  // background fetch alive past the response.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.whisperedevents.com'
  waitUntil(
    fetch(`${appUrl}/api/process-matches?trigger=event&id=${eventId}`).catch((e) =>
      console.error('claim-host: process-matches fire-and-forget error', e),
    ),
  )

  return NextResponse.json({ ok: true })
}
