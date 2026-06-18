import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import {
  checkDuplicate,
  createEvent,
  getPartnerUserByEmail,
} from '@/lib/airtable'
import { recordContribution } from '@/lib/supabase'
import { sendEventSubmittedEmail } from '@/lib/email'
import { EventRecord, VIRTUAL_LOCATION_RE } from '@/lib/types'

// Create-only endpoint as of the host-flow cleanup. Editing existing events
// happens at /host (magic-link auth + multi-host aware). Anything that used
// to land here with `existingId` set now falls through into the duplicate
// path below, which 409s — the right answer for "you already submitted this."

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { event } = body as { event: EventRecord }

    if (!event?.name || !event.link) {
      return NextResponse.json(
        { error: 'Event name and link are required' },
        { status: 400 }
      )
    }
    if (!event.submitter) {
      return NextResponse.json(
        { error: 'Submitter email is required' },
        { status: 400 }
      )
    }

    if (event.type === 'Virtual' || VIRTUAL_LOCATION_RE.test(event.location || '')) {
      return NextResponse.json(
        {
          error:
            'We no longer accept virtual events. Please submit only in-person events with a specific city.',
        },
        { status: 400 }
      )
    }

    // Defense-in-depth duplicate check (check-event already runs upstream
    // for chat-driven flows but inbound-email and direct API callers don't
    // hit that path).
    const dupCheck = await checkDuplicate(event.name, event.link, event.date)
    if (dupCheck.isDuplicate) {
      return NextResponse.json(
        {
          error:
            'This event already exists. Please refresh and submit again so we can pick up the latest record.',
        },
        { status: 409 }
      )
    }

    // Partners auto-link as Host on the new event. Non-partners just create
    // the event without a host — the contribute UI shows an inline notice
    // before submit so they already know claim-as-host requires partnership.
    let hostUserId: string | undefined
    if (event.host) {
      const partnerUser = await getPartnerUserByEmail(event.submitter)
      if (partnerUser) hostUserId = partnerUser.id
    }

    const id = await createEvent(event, hostUserId, 'Dashboard')

    recordContribution({
      email: event.submitter,
      eventId: id,
      eventName: event.name,
      source: 'form',
      airtableUserId: hostUserId ?? null,
    }).catch((e) => console.error('recordContribution error:', e))

    // Confirmation email to the submitter (BCC'd to MONITOR_BCC inside
    // sendEventSubmittedEmail so we see every send). Wrapped in waitUntil so
    // Vercel keeps the function alive past the response — a bare
    // .catch() promise gets killed when the parent returns.
    waitUntil(
      sendEventSubmittedEmail(event.submitter, event.name).catch((e) =>
        console.error('submit-event: sendEventSubmittedEmail failed', e),
      ),
    )

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    waitUntil(
      fetch(`${appUrl}/api/process-matches?trigger=event&id=${id}`).catch((e) =>
        console.error('process-matches fire-and-forget error:', e),
      ),
    )

    return NextResponse.json({ status: 'created', id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('submit-event error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
