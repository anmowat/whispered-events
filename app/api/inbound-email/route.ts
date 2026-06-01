import { NextRequest, NextResponse } from 'next/server'
import { Resend, type GetReceivingEmailResponseSuccess } from 'resend'
import { scrapeUrl } from '@/lib/scraper'
import { parseEventContent } from '@/lib/claude'
import {
  checkDuplicate,
  createEvent,
  getUserByEmail,
} from '@/lib/airtable'
import { recordContribution } from '@/lib/supabase'
import { sendEventCouldNotReadEmail, sendEventSubmittedEmail } from '@/lib/email'
import { EventRecord, VIRTUAL_LOCATION_RE } from '@/lib/types'

export const maxDuration = 60

const FROM = 'Whispered Events <event@whisperedevents.com>'

interface InboundPayload {
  type?: string
  data?: {
    email_id?: string
    from?: string | { email?: string; name?: string }
    subject?: string
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  console.log('inbound-email: webhook fired, body length', rawBody.length)

  if (!(await verifySvixSignature(req, rawBody))) {
    console.error('inbound-email: signature verification failed')
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: InboundPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  // Log the raw payload shape so we can diagnose extractor failures when
  // the `from` field arrives in an unexpected format from Resend.
  console.log('inbound-email: payload shape', {
    type: payload.type,
    fromType: typeof payload.data?.from,
    fromValue: payload.data?.from,
    hasEmailId: !!payload.data?.email_id,
    subject: payload.data?.subject,
  })

  // `let` because we may reassign below if the envelope from is one of
  // our own forwarder addresses (Google Workspace alias forwarding etc).
  let senderEmail = extractSenderEmail(payload.data?.from)
  if (!senderEmail) {
    console.error('inbound-email: could not extract sender', payload.data?.from)
    return NextResponse.json({ ok: true, reason: 'no sender' })
  }
  console.log('inbound-email: extracted sender', senderEmail)

  const emailId = payload.data?.email_id
  if (!emailId || !process.env.RESEND_API_KEY) {
    console.error('inbound-email: missing email_id or RESEND_API_KEY', { emailId, hasKey: !!process.env.RESEND_API_KEY })
    return NextResponse.json({ ok: true, reason: 'no email_id' })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const fetched = await resend.get<GetReceivingEmailResponseSuccess>(
    `/emails/receiving/${emailId}`,
  )
  if (fetched.error || !fetched.data) {
    console.error('inbound-email: receiving.get failed', fetched.error)
    return NextResponse.json({ ok: true, reason: 'fetch failed' })
  }

  const subject = fetched.data.subject ?? payload.data?.subject ?? ''
  const text = fetched.data.text ?? stripHtml(fetched.data.html ?? '')
  const combined = `${subject}\n\n${text}`
  const url = extractFirstUrl(combined)

  // When Google Workspace (or any external alias) forwards an inbound
  // event to Resend, the envelope `from` gets rewritten to the
  // forwarding mailbox — not the original sender. Detect that and
  // recover the real sender from the body's forwarded-message block
  // (Gmail/Outlook/etc all preserve the original From: header inline).
  // Without this, every forwarded event records the forwarder mailbox
  // as the submitter in Airtable.
  if (isOwnDomain(senderEmail)) {
    const original = extractOriginalSenderFromBody(text)
    if (original) {
      console.log(
        'inbound-email: envelope sender',
        senderEmail,
        'is a forwarder — using body-extracted original',
        original,
      )
      senderEmail = original
    } else {
      console.warn(
        'inbound-email: envelope sender',
        senderEmail,
        'looks like a forwarder but no original From: found in body',
      )
    }
  }

  console.log('inbound-email: effective sender', senderEmail, 'url', url, 'subject', subject)

  let content = combined
  if (url) {
    try {
      content = await scrapeUrl(url)
    } catch (e) {
      console.error('inbound-email: scrape failed, falling back to email body', e)
      content = `${combined}\n\nEvent URL: ${url}`
    }
  }

  const parsed = await parseEventContent(content, url)

  const link = parsed.link || url
  if (!parsed.name || !link) {
    console.error('inbound-email: parse incomplete', parsed)
    try {
      await sendEventCouldNotReadEmail(senderEmail)
    } catch (e) {
      console.error('inbound-email: sendEventCouldNotReadEmail failed', e)
    }
    return NextResponse.json({ ok: true, reason: 'parse incomplete' })
  }

  if (parsed.type === 'Virtual' || VIRTUAL_LOCATION_RE.test(parsed.location || '')) {
    await sendReply(
      senderEmail,
      'We only accept in-person events',
      `Hi,\n\nThanks for sending "${parsed.name}". Whispered Events only lists in-person events with a specific city, so we did not add this one.\n\n— Whispered Events`,
    )
    return NextResponse.json({ ok: true, reason: 'virtual' })
  }

  const existingUser = await getUserByEmail(senderEmail)

  const dup = await checkDuplicate(parsed.name, link, parsed.date)
  if (dup.isDuplicate) {
    recordContribution({
      email: senderEmail,
      eventId: dup.existingId,
      eventName: dup.existingRecord?.name ?? parsed.name,
      source: 'inbound_email',
      airtableUserId: existingUser?.id ?? null,
    }).catch((e) => console.error('inbound-email: recordContribution (duplicate) error', e))
    await sendReply(
      senderEmail,
      'Event already in Whispered',
      `Hi,\n\nGood news — "${parsed.name}" is already in Whispered Events, so members are already seeing it. Thanks for thinking of us.\n\n— Whispered Events`,
    )
    return NextResponse.json({ ok: true, reason: 'duplicate' })
  }

  const eventToCreate: EventRecord = {
    name: parsed.name,
    type: parsed.type ?? 'Other',
    date: parsed.date ?? '',
    location: parsed.location ?? '',
    description: parsed.description ?? '',
    link,
    audience: parsed.audience ?? [],
    host: false,
    submitter: senderEmail,
  }

  let id: string
  try {
    id = await createEvent(eventToCreate)
  } catch (e) {
    console.error('inbound-email: createEvent failed', e)
    // Send the "couldn't read your event" reply so the submitter
    // isn't ghosted. Same end-user experience as the parse-incomplete
    // path. Return 200 so Resend doesn't retry the webhook (the email
    // body's data is fundamentally broken — retrying won't help).
    try {
      await sendEventCouldNotReadEmail(senderEmail)
    } catch (e2) {
      console.error('inbound-email: sendEventCouldNotReadEmail (post-create-failure) failed', e2)
    }
    return NextResponse.json({ ok: true, reason: 'create failed' })
  }

  recordContribution({
    email: senderEmail,
    eventId: id,
    eventName: parsed.name,
    source: 'inbound_email',
    airtableUserId: existingUser?.id ?? null,
  }).catch((e) => console.error('inbound-email: recordContribution error', e))

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.whisperedevents.com'
  fetch(`${appUrl}/api/process-matches?trigger=event&id=${id}`).catch((e) =>
    console.error('inbound-email: process-matches fire-and-forget error', e),
  )

  try {
    console.log(
      'inbound-email: sending confirmation to',
      senderEmail,
      'for event',
      parsed.name,
    )
    await sendEventSubmittedEmail(senderEmail, parsed.name)
    console.log('inbound-email: confirmation sent OK to', senderEmail)
  } catch (e) {
    console.error('inbound-email: sendEventSubmittedEmail failed', e)
  }

  return NextResponse.json({ ok: true, id })
}

// Returns true if `email` is at one of our own / forwarder domains —
// i.e. it shouldn't be treated as the original submitter when an event
// is forwarded in through a Google Workspace alias.
function isOwnDomain(email: string): boolean {
  const e = email.toLowerCase()
  return (
    e.endsWith('@whisperedevents.com') ||
    e.endsWith('@whispered.com')
  )
}

// Scans a forwarded email body for the original sender's address.
// Gmail / Outlook / Apple Mail all preserve the original headers as
// plain text inside the body, looking like:
//
//   ---------- Forwarded message ----------
//   From: Kris Rudeegraap <kris@sendoso.com>
//   Date: ...
//
// We pick the first `From:` line that isn't one of our forwarder
// domains. Returns null if nothing matches.
function extractOriginalSenderFromBody(text: string): string | null {
  if (!text) return null
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(/^\s*From:\s*(?:[^<\n]*<)?([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})>?/i)
    if (!match) continue
    const candidate = match[1].toLowerCase()
    if (isOwnDomain(candidate)) continue
    return candidate
  }
  return null
}

function extractSenderEmail(from: unknown): string | null {
  if (!from) return null
  if (typeof from === 'object' && from !== null && 'email' in from) {
    const email = (from as { email?: string }).email
    return email ? email.toLowerCase() : null
  }
  if (typeof from !== 'string') return null
  const angle = from.match(/<([^>]+)>/)
  const raw = (angle ? angle[1] : from).trim().toLowerCase()
  return raw.includes('@') ? raw : null
}

function extractFirstUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s<>"')]+/)
  return match ? match[0].replace(/[.,;:!?)\]]+$/, '') : undefined
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function sendReply(to: string, subject: string, body: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: FROM,
      to,
      subject,
      text: body,
    })
  } catch (e) {
    console.error('inbound-email: sendReply failed', e)
  }
}

async function verifySvixSignature(req: NextRequest, body: string): Promise<boolean> {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET
  if (!secret) {
    console.warn('inbound-email: RESEND_INBOUND_WEBHOOK_SECRET not set — skipping verification')
    return true
  }

  const id = req.headers.get('svix-id')
  const timestamp = req.headers.get('svix-timestamp')
  const signatureHeader = req.headers.get('svix-signature')
  if (!id || !timestamp || !signatureHeader) return false

  const ageSec = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(ageSec) || ageSec > 5 * 60) return false

  const secretBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret)
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const data = new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  const sig = await crypto.subtle.sign('HMAC', key, data)
  const expected = bytesToBase64(new Uint8Array(sig))

  return signatureHeader.split(' ').some((part) => {
    const [, value] = part.split(',')
    return value && timingSafeEqual(value, expected)
  })
}

function base64ToBytes(b64: string) {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}
