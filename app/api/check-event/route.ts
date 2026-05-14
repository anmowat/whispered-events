import { NextRequest, NextResponse } from 'next/server'
import {
  checkDuplicate,
  getEventHostEmails,
  getPartnerUserByEmail,
  updateEvent,
} from '@/lib/airtable'
import { recordContribution } from '@/lib/supabase'
import { parseEventInput } from '@/lib/parse-event'
import { ParsedEvent } from '@/lib/types'

// Status router used by the contribute chat. Inline event-editing was retired
// once /host (magic-link-gated) shipped, so when we detect a duplicate we no
// longer return merged fields for a client-side editor — we just route the
// user into one of four outcomes:
//
//   - duplicate-existing-host    submitter is already on the Host list →
//                                tell them to edit at /host
//   - duplicate-claim-available  no host on file AND submitter is a partner →
//                                offer "claim as host"
//   - duplicate-claim-additional has a host AND submitter is a different
//                                partner → offer "are you also a host?"
//   - duplicate-not-host         everything else → standard "already in
//                                our system" message
//
// All four still record a contribution row (source: 'check_event') so the
// duplicate-spotter gets attribution.

export const maxDuration = 30

type CheckResponse =
  | { status: 'new'; parsed: ParsedEvent }
  | { status: 'duplicate-not-host' }
  | { status: 'duplicate-existing-host'; existingId: string }
  | { status: 'duplicate-claim-available'; existingId: string }
  | { status: 'duplicate-claim-additional'; existingId: string }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { input, email } = body as { input?: string; email?: string }

    if (!input?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'input and email are required' }, { status: 400 })
    }

    const { parsed, isUrl } = await parseEventInput(input.trim())
    const link = parsed.link || (isUrl ? input.trim() : '')
    const dup = await checkDuplicate(parsed.name || '', link, parsed.date)

    if (!dup.isDuplicate || !dup.existingId) {
      const response: CheckResponse = {
        status: 'new',
        parsed: { ...parsed, link },
      }
      return NextResponse.json(response)
    }

    const submitterEmail = email.trim().toLowerCase()
    const hostEmails = await getEventHostEmails(dup.existingId)
    const isExistingHost = hostEmails.includes(submitterEmail)

    // Credit the duplicate-spotter in every branch. Stamp the latest
    // submitter on the Airtable row too — same behaviour we had before
    // the inline-edit retirement.
    updateEvent(dup.existingId, { submitter: email.trim() }).catch((e) =>
      console.error('check-event submitter update error:', e),
    )
    recordContribution({
      email: email.trim(),
      eventId: dup.existingId,
      eventName: dup.existingRecord?.name,
      source: 'check_event',
    }).catch((e) => console.error('check-event recordContribution error:', e))

    if (isExistingHost) {
      const response: CheckResponse = {
        status: 'duplicate-existing-host',
        existingId: dup.existingId,
      }
      return NextResponse.json(response)
    }

    // Not a host yet — partner gate decides whether to offer claim flow.
    const partner = await getPartnerUserByEmail(submitterEmail)
    if (partner) {
      const status: CheckResponse['status'] =
        hostEmails.length === 0
          ? 'duplicate-claim-available'
          : 'duplicate-claim-additional'
      const response: CheckResponse = { status, existingId: dup.existingId }
      return NextResponse.json(response)
    }

    const response: CheckResponse = { status: 'duplicate-not-host' }
    return NextResponse.json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('check-event error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
