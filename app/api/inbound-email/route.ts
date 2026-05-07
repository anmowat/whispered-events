import { NextRequest, NextResponse } from 'next/server'
import { Resend, type GetReceivingEmailResponseSuccess } from 'resend'
import { scrapeUrl } from '@/lib/scraper'
import { parseEventContent } from '@/lib/claude'
import {
  checkDuplicate,
  createEvent,
  createMinimalUser,
  getUserByEmail,
  updateLastContribution,
} from '@/lib/airtable'
import { EventRecord, VIRTUAL_LOCATION_RE } from '@/lib/types'

export const maxDuration = 60

const FROM = 'Whispered Events <events@whisperedevents.com>'

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

  const senderEmail = extractSenderEmail(payload.data?.from)
  if (!senderEmail) {
    console.error('inbound-email: could not extract sender', payload.data?.from)
    return NextResponse.json({ ok: true, reason: 'no sender' })
  }

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

  console.log(
    `inbound-email: from=${senderEmail} subject=${JSON.stringify(subject)} text=${text.length}b url=${url}`,
  )

  let content = combined
  if (url) {
    try {
      content = await scrapeUrl(url)
    } catch (e) {
      console.error('inbound-email: scrape failed, falling back to email body', e)
      content = `${combined}\n\nEvent URL: ${url}`
    }
  }

  console.log(`inbound-email: content length=${content.length}`)
  const parsed = await parseEventContent(content, url)

  const link = parsed.link || url
  if (!parsed.name || !link) {
    console.error('inbound-email: parse incomplete', parsed)
    await sendReply(
      senderEmail,
      'We could not read your event',
      `Hi,\n\nThanks for sending an event to Whispered Events. We were not able to extract the details automatically.\n\nReply with a public event link (Luma, Eventbrite, the host's site, etc.) and we will try again.\n\n— Whispered Events`,
    )
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

  const dup = await checkDuplicate(parsed.name, link, parsed.date)
  if (dup.isDuplicate) {
    await sendReply(
      senderEmail,
      'Event already in Whispered',
      `Hi,\n\nGood news — "${parsed.name}" is already in Whispered Events, so members are already seeing it. Thanks for thinking of us.\n\n— Whispered Events`,
    )
    return NextResponse.json({ ok: true, reason: 'duplicate' })
  }

  const existingUser = await getUserByEmail(senderEmail)
  if (!existingUser) {
    try {
      await createMinimalUser(senderEmail)
    } catch (e) {
      console.error('inbound-email: createMinimalUser failed', e)
    }
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
    return NextResponse.json({ error: 'create failed' }, { status: 500 })
  }

  updateLastContribution(senderEmail).catch((e) =>
    console.error('inbound-email: updateLastContribution error', e),
  )

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.whisperedevents.com'
  fetch(`${appUrl}/api/process-matches?trigger=event&id=${id}`).catch((e) =>
    console.error('inbound-email: process-matches fire-and-forget error', e),
  )

  await sendReply(
    senderEmail,
    `Added: ${parsed.name}`,
    `Hi,\n\nThanks for contributing! "${parsed.name}" has been added to Whispered Events and you have been credited. Members whose profiles match will be notified.\n\n— Whispered Events`,
  )

  return NextResponse.json({ ok: true, id })
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
