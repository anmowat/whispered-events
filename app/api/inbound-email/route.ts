import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { Resend, type GetReceivingEmailResponseSuccess } from 'resend'
import { scrapeUrl } from '@/lib/scraper'
import { parseEventContent } from '@/lib/claude'
import { createEvent } from '@/lib/airtable'
import { getUserByEmail } from '@/lib/users'
import { checkDuplicate } from '@/lib/events'
import { recordContribution, getContributionStatsByEmail } from '@/lib/supabase'
import { sendEventCouldNotReadEmail, sendEventSubmittedEmail, sendDroppedEmailNotification } from '@/lib/email'
import { notifyNewEvent } from '@/lib/slack'
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
    void sendDroppedEmailNotification({
      reason: 'fetch failed',
      originalFrom: senderEmail,
      originalSubject: payload.data?.subject ?? '',
      originalBody: `Could not fetch email from Resend. Error: ${JSON.stringify(fetched.error)}`,
      urlFound: undefined,
    })
    return NextResponse.json({ ok: true, reason: 'fetch failed' })
  }

  const subject = fetched.data.subject ?? payload.data?.subject ?? ''
  const text = fetched.data.text ?? stripHtml(fetched.data.html ?? '')
  const combined = `${subject}\n\n${text}`
  const url = extractFirstUrl(combined, fetched.data.html ?? undefined)

  // Loop-breaker #1: bail on machine-generated messages. RFC 3834 says
  // auto-responders MUST set Auto-Submitted; our own outbound mail
  // carries Auto-Submitted: auto-generated, so a forwarded copy that
  // lands back here gets dropped without triggering another reply.
  //
  // We deliberately do NOT inspect Precedence here — that header was
  // deprecated decades ago and intermediaries (Gmail SMTP, Resend's
  // relay, alias forwarders) add Precedence: list to perfectly normal
  // user-composed mail, which would silently swallow legitimate
  // submissions.
  const headersRaw = (fetched.data as { headers?: Record<string, string> }).headers ?? {}
  const headerLookup = Object.fromEntries(
    Object.entries(headersRaw).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]),
  )
  const autoSubmitted = headerLookup['auto-submitted']
  // Only drop definitively machine-generated mail: auto-generated (our own
  // outbound) and auto-replied (OOO responses). Anything else — including
  // auto-forwarded, 'auto-forwarded; type=group', or relay artifacts — is
  // allowed through. Old code dropped everything except 'no'/'auto-forwarded',
  // which silently swallowed legitimate submissions from corporate relays.
  const MACHINE_GENERATED = new Set(['auto-generated', 'auto-replied'])
  if (autoSubmitted && MACHINE_GENERATED.has(autoSubmitted)) {
    console.log('inbound-email: dropping machine-generated message', { autoSubmitted, senderEmail })
    // If this is NOT our own domain sending it, it may be a legitimate submission
    // that got wrongly flagged by a relay. Notify Andy so nothing is silently lost.
    if (!isOwnDomain(senderEmail)) {
      void sendDroppedEmailNotification({
        reason: 'auto-submitted',
        originalFrom: senderEmail,
        originalSubject: subject,
        originalBody: text,
        urlFound: url,
        autoSubmittedHeader: autoSubmitted,
      })
    }
    return NextResponse.json({ ok: true, reason: 'auto-submitted' })
  }

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
        'looks like a forwarder but no original From: found in body — body preview:',
        text.slice(0, 500),
      )
      if (url) {
        // A URL was found so this is likely a real submission whose sender
        // couldn't be recovered. Use a placeholder and still create the event.
        // Andy sees the Slack notification from notifyNewEvent as usual.
        console.log('inbound-email: proceeding with unknown@external sender, url', url)
        senderEmail = 'unknown@external'
      } else {
        // No URL and no identifiable sender — notify Andy with the raw body
        // so he can investigate, then drop.
        void sendDroppedEmailNotification({
          reason: 'self-domain (no url, no original sender found)',
          originalFrom: senderEmail,
          originalSubject: subject,
          originalBody: text,
          urlFound: undefined,
        })
        return NextResponse.json({ ok: true, reason: 'self-domain' })
      }
    }
  }

  // Loop-breaker #2: if after body recovery the sender is still on our
  // own domain, this is almost certainly our own mail looping back
  // through a forwarder. Drop it without replying so we can't fan out
  // another auto-response.
  if (isOwnDomain(senderEmail)) {
    console.warn('inbound-email: dropping self-domain message to prevent loop', senderEmail)
    return NextResponse.json({ ok: true, reason: 'self-domain' })
  }

  console.log('inbound-email: effective sender', senderEmail, 'url', url, 'subject', subject)

  let content = combined
  let imageUrl: string | undefined
  if (url) {
    try {
      const scrape = await scrapeUrl(url)
      imageUrl = scrape.imageUrl
      // JS-rendered SPAs often return a near-empty shell via plain fetch.
      // If we got less than 300 chars of meaningful text, keep the email
      // body in the context too so Claude can extract whatever the sender
      // included (dates mentioned in forwarded copy, subject lines, etc.).
      if (scrape.text.length < 300) {
        console.log('inbound-email: scraped content thin (%d chars), merging with email body', scrape.text.length)
        content = `${combined}\n\nScraped page content:\n${scrape.text}`
      } else {
        content = scrape.text
      }
    } catch (e) {
      console.error('inbound-email: scrape failed, falling back to email body', e)
      content = `${combined}\n\nEvent URL: ${url}`
    }
  }

  const parsed = await parseEventContent(content, url)
  if (imageUrl) parsed.image = imageUrl

  const link = parsed.link || url
  if (!parsed.name || !link) {
    console.error('inbound-email: parse incomplete', parsed)
    const isUnknown = senderEmail === 'unknown@external'
    if (!isUnknown) {
      try {
        await sendEventCouldNotReadEmail(senderEmail, url)
      } catch (e) {
        console.error('inbound-email: sendEventCouldNotReadEmail failed', e)
      }
    }
    void sendDroppedEmailNotification({
      reason: 'parse incomplete',
      originalFrom: senderEmail,
      originalSubject: subject,
      originalBody: text,
      urlFound: url,
    })
    return NextResponse.json({ ok: true, reason: 'parse incomplete' })
  }

  if ((parsed.type as string) === 'Virtual' || VIRTUAL_LOCATION_RE.test(parsed.location || '')) {
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
    image: parsed.image,
  }

  let id: string
  try {
    id = await createEvent(eventToCreate, undefined, 'Email')
  } catch (e) {
    console.error('inbound-email: createEvent failed', e)
    const isUnknown = senderEmail === 'unknown@external'
    if (!isUnknown) {
      try {
        await sendEventCouldNotReadEmail(senderEmail, url)
      } catch (e2) {
        console.error('inbound-email: sendEventCouldNotReadEmail (post-create-failure) failed', e2)
      }
    }
    void sendDroppedEmailNotification({
      reason: `create failed: ${e instanceof Error ? e.message : String(e)}`,
      originalFrom: senderEmail,
      originalSubject: subject,
      originalBody: text,
      urlFound: url,
    })
    return NextResponse.json({ ok: true, reason: 'create failed' })
  }

  waitUntil(
    notifyNewEvent(eventToCreate, id, existingUser).catch((e) =>
      console.error('inbound-email: notifyNewEvent failed', e),
    ),
  )

  // Await record-then-count so the confirmation email reflects the
  // running total post-insert (used to surface contribution
  // milestones). Inbound-email is a webhook, not a user-facing
  // route, so the extra ~200ms here doesn't affect any human.
  // Skip for unknown@external — we have no real email to attribute.
  let contributionsTotal = 0
  if (senderEmail !== 'unknown@external') {
    try {
      await recordContribution({
        email: senderEmail,
        eventId: id,
        eventName: parsed.name,
        source: 'inbound_email',
        airtableUserId: existingUser?.id ?? null,
      })
    } catch (e) {
      console.error('inbound-email: recordContribution error', e)
    }
    try {
      const stats = await getContributionStatsByEmail(senderEmail)
      contributionsTotal = stats.total
    } catch (e) {
      console.error('inbound-email: getContributionStats failed', e)
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.whisperedevents.com'
  waitUntil(
    fetch(`${appUrl}/api/process-matches?trigger=event&id=${id}`).catch((e) =>
      console.error('inbound-email: process-matches fire-and-forget error', e),
    ),
  )

  if (senderEmail !== 'unknown@external') {
    try {
      console.log(
        'inbound-email: sending confirmation to',
        senderEmail,
        'for event',
        parsed.name,
      )
      await sendEventSubmittedEmail(senderEmail, parsed.name, contributionsTotal, link)
      console.log('inbound-email: confirmation sent OK to', senderEmail)
    } catch (e) {
      console.error('inbound-email: sendEventSubmittedEmail failed', e)
    }
  }

  return NextResponse.json({ ok: true, id })
}

// Returns true if `email` is at one of our own forwarder/system addresses
// — i.e. envelope From here means either a Google Workspace alias
// rewrite (need body-sender recovery) or our own outbound looping back
// (need to drop).
//
// All of @whisperedevents.com is system-owned. On @whispered.com we ONLY
// match specific mailbox addresses we route inbound from
// (event@whispered.com is a Google Group forwarding to Resend's inbound;
// events@whispered.com is the legacy variant). andy@whispered.com is
// Andy's personal mail — must NOT be caught here or his legitimate
// event submissions get dropped.
const SYSTEM_WHISPERED_COM_MAILBOXES = new Set([
  'event@whispered.com',
  'events@whispered.com',
])

function isOwnDomain(email: string): boolean {
  const e = email.toLowerCase()
  if (e.endsWith('@whisperedevents.com')) return true
  return SYSTEM_WHISPERED_COM_MAILBOXES.has(e)
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

function extractFirstUrl(text: string, html?: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s<>"')]+/)
  if (match) return match[0].replace(/[.,;:!?)\]]+$/, '')
  // Fallback: scan href attributes in raw HTML for emails that are HTML-only
  // and whose URL doesn't appear as visible text (e.g. "Click here" links).
  if (html) {
    const href = html.match(/href=["']?(https?:\/\/[^"'\s>]+)/i)
    if (href) return href[1].replace(/[.,;:!?)\]]+$/, '')
  }
  return undefined
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
      bcc: 'andy@whisperedevents.com',
      subject,
      text: body,
      headers: { 'Auto-Submitted': 'auto-generated' },
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
