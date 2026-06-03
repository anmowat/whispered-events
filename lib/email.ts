import { Resend } from 'resend'
import { AirtableEvent, AirtableUser } from './airtable'
import { logDigestSend } from './supabase'

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY must be set')
  return new Resend(process.env.RESEND_API_KEY)
}

const FROM = 'Whispered Events <events@whisperedevents.com>'
const TEAM_FROM = 'Whispered Events <team@whisperedevents.com>'
const EVENT_FROM = 'Whispered Events <event@whisperedevents.com>'

const ANDY_LINK = 'https://www.linkedin.com/in/amowat/'
const AMPLIFY_POST_LINK =
  'https://www.linkedin.com/feed/update/urn:li:activity:7459465011686453248'

// BCC'd on every user-facing send so we can monitor copy/formatting in
// real time. Excluded from magic-link emails (those contain auth tokens —
// a compromised inbox here would otherwise grant session access).
const MONITOR_BCC = 'andy@whisperedevents.com'

// RFC 3834 auto-response header: tells well-behaved mail systems (and our
// own inbound webhook) that the message was machine-generated, so they
// don't auto-reply / re-forward back into us and create a loop.
const AUTO_HEADERS = { 'Auto-Submitted': 'auto-generated' as const }

// ----- Salon palette (inlined; CSS vars don't work in email clients) -----
const C = {
  bg:           '#F1ECE2',
  paper:        '#FBF8F1',
  paper2:       '#F6F1E5',
  ink:          '#1B1814',
  ink2:         '#4A433B',
  ink3:         '#8A8276',
  rule:         '#DDD3C0',
  ruleSoft:     '#E9E2D2',
  accent:       '#6E1F2B',
  accent2:      '#8A2A38',
  accentSoft:   '#F2DDD9',
}

// Serif stack used for headlines + the wordmark. Web fonts via Google
// link work in Gmail/Apple Mail; everything else falls back to Georgia.
const SERIF = `'Instrument Serif', Georgia, 'Times New Roman', serif`
const WORDMARK = `'Newsreader', Georgia, 'Times New Roman', serif`
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`

const FONT_LINK = `<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Newsreader:wght@500&display=swap" rel="stylesheet">`

const DASHBOARD_LINK = 'https://www.whisperedevents.com/dashboard'
const TAG_US_LINK =
  'https://www.linkedin.com/company/whispered-events/about/?viewAsMember=true'
const NEW_EVENT_MAILTO = 'mailto:event@whisperedevents.com'

// ----- Shared building blocks -----

// Page wrapper. The header style block is included once at the top of
// the body so the Google Fonts <link> resolves; Resend strips full
// <html><head> sometimes so we keep <link> inline within the body too.
function shell(inner: string): string {
  return `
<div style="margin:0;padding:24px 0;background:${C.bg};font-family:${SANS};color:${C.ink};">
  ${FONT_LINK}
  <div style="max-width:600px;margin:0 auto;background:${C.paper};border:1px solid ${C.rule};border-radius:6px;padding:32px 32px 28px;">
    ${wordmark()}
    <div style="height:1px;background:${C.rule};margin:18px 0 24px;"></div>
    ${inner}
  </div>
</div>
`.trim()
}

// "Whispered Events" wordmark — Newsreader 500, color contrast only.
function wordmark(): string {
  return `
<div style="line-height:1;">
  <span style="font-family:${WORDMARK};font-size:20px;font-weight:500;color:rgba(0,0,0,0.30);letter-spacing:-0.012em;">Whispered</span>
  <span style="font-family:${WORDMARK};font-size:20px;font-weight:500;color:${C.ink};letter-spacing:-0.012em;margin-left:6px;">Events</span>
</div>
`.trim()
}

function h1(text: string): string {
  return `<h1 style="font-family:${SERIF};font-size:32px;font-weight:400;letter-spacing:-0.01em;color:${C.ink};margin:0;line-height:1.1;">${text}</h1>`
}

function p(text: string, opts: { color?: string; size?: number; mt?: number } = {}): string {
  const { color = C.ink2, size = 14.5, mt = 14 } = opts
  return `<p style="font-family:${SANS};font-size:${size}px;line-height:1.6;color:${color};margin:${mt}px 0 0;">${text}</p>`
}

function eyebrow(text: string): string {
  return `<div style="font-family:${SANS};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${C.ink3};font-weight:500;">${text}</div>`
}

function accentButton(href: string, label: string): string {
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 0;width:100%;">
  <tr>
    <td align="center" style="background:${C.accent};border-radius:999px;">
      <a href="${href}" style="display:inline-block;padding:11px 22px;color:#ffffff;text-decoration:none;font-family:${SANS};font-size:13px;font-weight:500;">${label}&nbsp;→</a>
    </td>
  </tr>
</table>
`.trim()
}

function signature(): string {
  return `
<p style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.ink};margin:24px 0 0;">
  <a href="${ANDY_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">Andy</a><br>
  <span style="color:${C.ink3};font-size:12px;">Founder, Whispered</span>
</p>
`.trim()
}

function ps(text: string): string {
  return `<p style="font-family:${SANS};color:${C.ink3};font-size:12px;line-height:1.6;margin-top:22px;">${text}</p>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Shared three-line footer used at the bottom of every content email
// except the pre-approval send. Bold label + colon + single-action
// link, separated by hairlines.
function digestFooterHtml(): string {
  return `
<div style="margin-top:28px;padding-top:18px;border-top:1px solid ${C.rule};font-family:${SANS};font-size:13px;line-height:1.7;color:${C.ink2};">
  <div><strong style="color:${C.ink};">Improve your matches:</strong> Update on <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">your Dashboard</a></div>
  <div><strong style="color:${C.ink};">Share Event:</strong> Email <a href="${NEW_EVENT_MAILTO}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">event@whisperedevents.com</a></div>
  <div><strong style="color:${C.ink};">See more events (help us grow):</strong> Share with others + post on LinkedIn and <a href="${TAG_US_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">tag us</a></div>
</div>
`.trim()
}

function digestFooterTextLines(): string[] {
  return [
    `Improve your matches: Update on your Dashboard — ${DASHBOARD_LINK}`,
    `Share Event: Email event@whisperedevents.com`,
    `See more events (help us grow): Share with others + post on LinkedIn and tag us — ${TAG_US_LINK}`,
  ]
}

// ----- Transactional sends -----

export async function sendUserAppliedEmail(email: string): Promise<void> {
  const resend = getResend()
  const html = shell(`
    ${h1('Application <span style="font-style:italic;">received</span>.')}
    ${p("Thanks for applying to Whispered Events. We'll quickly verify your LinkedIn profile and activate your account — typically within 24 hours.", { mt: 14 })}
    ${p("Once approved, you'll start seeing event matches curated for senior operators and executives.", { mt: 12 })}
    ${p("We built Whispered Events for one reason: helping great people find the best events — the ones that aren't posted, they're whispered.", { mt: 12 })}
    ${p(`If you love it, amplify <a href="${AMPLIFY_POST_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">this post</a> on LinkedIn with a comment / repost. We &#10084; feedback and feature ideas.`, { mt: 14 })}
    ${signature()}
    ${ps('P.S. You can submit events anytime on the site or by emailing event@whisperedevents.com')}
  `)
  const text = `Application received.

Thanks for applying to Whispered Events. We'll quickly verify your LinkedIn profile and activate your account — typically within 24 hours.

Once approved, you'll start seeing event matches curated for senior operators and executives.

We built Whispered Events for one reason: helping great people find the best events — the ones that aren't posted, they're whispered.

If you love it, amplify this post on LinkedIn with a comment/repost (${AMPLIFY_POST_LINK}). We love feedback and feature ideas.

Andy (${ANDY_LINK})
Founder, Whispered

P.S. You can submit events anytime on the site or by emailing event@whisperedevents.com`
  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: email,
    bcc: MONITOR_BCC,
    subject: 'Whispered Events — Application Received',
    html,
    text,
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendUserAppliedEmail: Resend error', { email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
}

export async function sendUserApprovedEmail(user: AirtableUser): Promise<void> {
  const resend = getResend()
  const firstName = firstNameOrThere(user)
  const html = shell(`
    ${h1(`<span style="font-style:italic;">Welcome</span> to the club, ${escapeHtml(firstName)}.`)}
    ${p("You've been approved for Whispered Events. Login via the top right of the site to see your matches — matches typically appear within ~5 minutes of approval.", { mt: 14 })}
    ${p("You can update your profile anytime to refine your matches — and we &#10084; feedback and feature ideas.", { mt: 12 })}
    ${p("Whispered Events is 100% free, built to help executives discover great events — the ones that aren't posted, they're whispered.", { mt: 12 })}
    ${digestFooterHtml()}
  `)
  const text = [
    `Welcome to the club, ${firstName}.`,
    '',
    "You've been approved for Whispered Events. Login via the top right of the site to see your matches — matches typically appear within ~5 minutes of approval.",
    '',
    'You can update your profile anytime to refine your matches — and we love feedback and feature ideas.',
    '',
    "Whispered Events is 100% free, built to help executives discover great events — the ones that aren't posted, they're whispered.",
    '',
    ...digestFooterTextLines(),
  ].join('\n')
  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    bcc: MONITOR_BCC,
    subject: "You're approved for Whispered Events",
    html,
    text,
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendUserApprovedEmail: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
}

export async function sendEventSubmittedEmail(email: string, eventName: string): Promise<void> {
  const resend = getResend()
  const safeName = escapeHtml(eventName)
  const html = shell(`
    ${h1(`Event <span style="font-style:italic;">added</span>.`)}
    ${p('Thanks for contributing an event to Whispered Events — the platform is powered by contributions like yours.', { mt: 14 })}
    ${p(`<strong style="color:${C.ink};">"${safeName}"</strong> has been added, and we've updated your contributions.`, { mt: 12 })}
    ${p('Have a great time at your next event, and keep sharing Whispered Events with your network so more great people can discover the right events.', { mt: 12 })}
    ${digestFooterHtml()}
  `)
  const text = [
    'Event added.',
    '',
    'Thanks for contributing an event to Whispered Events — the platform is powered by contributions like yours.',
    '',
    `"${eventName}" has been added, and we've updated your contributions.`,
    '',
    'Have a great time at your next event, and keep sharing Whispered Events with your network so more great people can discover the right events.',
    '',
    ...digestFooterTextLines(),
  ].join('\n')
  const { error } = await resend.emails.send({
    from: EVENT_FROM,
    to: email,
    bcc: MONITOR_BCC,
    subject: `Event added — ${eventName}`,
    html,
    text,
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendEventSubmittedEmail: Resend error', { email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
}

export async function sendEventCouldNotReadEmail(email: string): Promise<void> {
  const resend = getResend()
  const html = shell(`
    ${h1(`We couldn't <span style="font-style:italic;">read</span> your event.`)}
    ${p('Thanks for sending an event to Whispered Events — the platform is powered by contributions like yours.', { mt: 14 })}
    ${p("We weren't able to extract the event details.", { mt: 12 })}
    ${p("If you have a public event link (Luma, Eventbrite, the host's site, etc.), send it over and we'll try again.", { mt: 12 })}
    ${digestFooterHtml()}
  `)
  const text = [
    "We couldn't read your event.",
    '',
    'Thanks for sending an event to Whispered Events — the platform is powered by contributions like yours.',
    '',
    "We weren't able to extract the event details.",
    '',
    "If you have a public event link (Luma, Eventbrite, the host's site, etc.), send it over and we'll try again.",
    '',
    ...digestFooterTextLines(),
  ].join('\n')
  const { error } = await resend.emails.send({
    from: EVENT_FROM,
    to: email,
    bcc: MONITOR_BCC,
    subject: "We couldn't read your event",
    html,
    text,
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendEventCouldNotReadEmail: Resend error', { email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
}

export async function sendMagicLink(email: string, token: string, baseUrl: string): Promise<void> {
  const resend = getResend()
  const link = `${baseUrl}/api/auth/verify?token=${token}`
  // Magic-link email: no monitor BCC because the link is single-use auth.
  // Layout mirrors the magic-link mockup from the design pack.
  const html = `
<div style="margin:0;padding:24px 0;background:${C.bg};font-family:${SANS};color:${C.ink};">
  ${FONT_LINK}
  <div style="max-width:460px;margin:0 auto;background:${C.paper};border:1px solid ${C.rule};border-radius:6px;padding:32px 32px 28px;">
    ${wordmark()}
    <div style="height:1px;background:${C.rule};margin:18px 0 24px;"></div>
    ${h1('Your one-time <span style="font-style:italic;">login link</span>.')}
    ${p('Tap below to sign in to Whispered Events. This link expires in 15 minutes and can only be used once.', { mt: 14, size: 14 })}
    ${accentButton(link, 'Open Whispered Events')}
    <p style="font-family:${SANS};color:${C.ink3};font-size:12px;line-height:1.6;margin-top:18px;">
      Or paste this link into your browser:<br>
      <span style="word-break:break-all;font-size:11.5px;color:${C.ink2};">${link}</span>
    </p>
    <div style="height:1px;background:${C.rule};margin:24px 0 14px;"></div>
    <p style="font-family:${SANS};color:${C.ink3};font-size:11.5px;line-height:1.6;margin:0;">
      Didn't request this? You can safely ignore this email.<br>
      Whispered Events — for executives only.
    </p>
  </div>
</div>
`.trim()
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Your Whispered Events login link',
    html,
    text: `Sign in to Whispered Events.\n\nThis link expires in 15 minutes and can only be used once.\n\n${link}\n\nDidn't request this? You can safely ignore this email.`,
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendMagicLink: Resend error', { email, from: FROM, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
  console.log('sendMagicLink: sent', { email, id: data?.id })
}

// ----- Digests -----

export interface DigestEventEntry {
  event: AirtableEvent
  matchPercent: number
  // Set on Top Matches rows whose event also appears in the New section.
  isDuplicate?: boolean
}

export interface DigestPayload {
  newEvents: DigestEventEntry[]
  topMatches: DigestEventEntry[]
}

export function firstNameOrThere(user: AirtableUser): string {
  const f = user.firstName?.trim()
  if (f && f.toUpperCase() !== 'DEFAULT') return f
  if (user.name && user.name !== 'DEFAULT') {
    const token = user.name.split(' ')[0]?.trim()
    if (token) return token
  }
  return 'there'
}

function shortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

function renderEntry(entry: DigestEventEntry): string {
  const { event, matchPercent, isDuplicate } = entry
  const date = shortDate(event.date)
  const datePart = date
    ? `<strong style="color:${C.accent};font-variant-numeric:tabular-nums;"> (${date})</strong> `
    : ' '
  const match = `<strong style="color:${C.ink};">(Match ${Math.round(matchPercent)}%)</strong>`
  const body = isDuplicate
    ? `<em style="color:${C.ink3};">see above</em> `
    : event.description
      ? `<span style="color:${C.ink2};">${escapeHtml(event.description)}</span> `
      : ''
  return `
<p style="font-family:${SANS};margin:0 0 14px;font-size:14.5px;line-height:1.55;">
  <a href="${event.link}" style="font-family:${SERIF};font-size:17px;color:${C.ink};text-decoration:none;font-weight:400;letter-spacing:-0.01em;">${escapeHtml(event.name)}</a>${datePart}${body}${match}
</p>
`.trim()
}

function markDuplicates(payload: DigestPayload): DigestPayload {
  const newIds = new Set(payload.newEvents.map((e) => e.event.id))
  const topMatches = payload.topMatches.map((e) => ({
    ...e,
    isDuplicate: newIds.has(e.event.id),
  }))
  const allDup = topMatches.length > 0 && topMatches.every((e) => e.isDuplicate)
  return {
    newEvents: payload.newEvents,
    topMatches: allDup ? [] : topMatches,
  }
}

function renderSection(title: string, entries: DigestEventEntry[]): string {
  if (!entries.length) return ''
  return `
<h2 style="font-family:${SERIF};margin:24px 0 12px;font-size:22px;font-weight:400;color:${C.ink};letter-spacing:-0.01em;">${title}</h2>
${entries.map(renderEntry).join('')}
`.trim()
}

export async function sendApprovedWithDigest(
  user: AirtableUser,
  payload: DigestPayload,
): Promise<void> {
  const resend = getResend()
  const firstName = firstNameOrThere(user)
  const hasMatches = payload.newEvents.length > 0 || payload.topMatches.length > 0
  const annotated = markDuplicates(payload)

  const html = shell(`
    ${h1(`<span style="font-style:italic;">Welcome</span> to the club, ${escapeHtml(firstName)}.`)}
    ${p(`You've been approved for Whispered Events.${hasMatches ? ' Here are some upcoming events that match your profile:' : ''}`, { mt: 14 })}
    ${renderSection('New', annotated.newEvents)}
    ${renderSection('Top Matches', annotated.topMatches)}
    ${digestFooterHtml()}
  `)

  const textLines: string[] = [
    `Welcome to the club, ${firstName}.`,
    '',
    `You've been approved for Whispered Events.${hasMatches ? ' Here are some upcoming events that match your profile:' : ''}`,
    '',
  ]
  const appendSection = (title: string, entries: DigestEventEntry[]) => {
    if (!entries.length) return
    textLines.push(title, '')
    for (const entry of entries) {
      const { event, matchPercent, isDuplicate } = entry
      const date = shortDate(event.date)
      const datePart = date ? ` (${date})` : ''
      const body = isDuplicate ? ' see above' : event.description ? ` ${event.description}` : ''
      textLines.push(`${event.name}${datePart}${body} (Match ${Math.round(matchPercent)}%)`)
      textLines.push(event.link)
      textLines.push('')
    }
  }
  appendSection('New', annotated.newEvents)
  appendSection('Top Matches', annotated.topMatches)
  textLines.push(...digestFooterTextLines())
  const text = textLines.join('\n')

  const subject = hasMatches
    ? 'Welcome to Whispered Events — your first matches'
    : "You're approved for Whispered Events"

  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    bcc: MONITOR_BCC,
    subject,
    html,
    text,
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendApprovedWithDigest: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
  // Only log when the welcome actually carried events — a no-match
  // approval email is informational, not a digest.
  if (hasMatches) {
    const eventIds = [
      ...annotated.newEvents.map((e) => e.event.id),
      ...annotated.topMatches.map((e) => e.event.id),
    ]
    await logDigestSend({
      userId: user.id,
      userEmail: user.email,
      kind: 'welcome',
      eventIds: Array.from(new Set(eventIds)),
    })
  }
}

export async function sendUserDigest(
  user: AirtableUser,
  payload: DigestPayload,
  kind: 'per_event' | 'cron' = 'cron',
): Promise<void> {
  if (!payload.newEvents.length) return
  const resend = getResend()
  const firstName = firstNameOrThere(user)
  const annotated = markDuplicates(payload)

  const html = shell(`
    ${h1(`New <span style="font-style:italic;">whispers</span> for ${escapeHtml(firstName)}.`)}
    ${p('We have some new matching Whispered Events for you.', { mt: 12 })}
    ${renderSection('New', annotated.newEvents)}
    ${renderSection('Top Matches', annotated.topMatches)}
    ${digestFooterHtml()}
  `)

  const textLines: string[] = [
    `New whispers for ${firstName}.`,
    '',
    'We have some new matching Whispered Events for you.',
    '',
  ]
  const appendSection = (title: string, entries: DigestEventEntry[]) => {
    if (!entries.length) return
    textLines.push(title, '')
    for (const entry of entries) {
      const { event, matchPercent, isDuplicate } = entry
      const date = shortDate(event.date)
      const datePart = date ? ` (${date})` : ''
      const body = isDuplicate ? ' see above' : event.description ? ` ${event.description}` : ''
      textLines.push(`${event.name}${datePart}${body} (Match ${Math.round(matchPercent)}%)`)
      textLines.push(event.link)
      textLines.push('')
    }
  }
  appendSection('New', annotated.newEvents)
  appendSection('Top Matches', annotated.topMatches)
  textLines.push(...digestFooterTextLines())
  const text = textLines.join('\n')

  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    bcc: MONITOR_BCC,
    subject: 'New matching Whispered Events',
    html,
    text,
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendUserDigest: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
  const eventIds = [
    ...annotated.newEvents.map((e) => e.event.id),
    ...annotated.topMatches.map((e) => e.event.id),
  ]
  await logDigestSend({
    userId: user.id,
    userEmail: user.email,
    kind,
    eventIds: Array.from(new Set(eventIds)),
  })
}
