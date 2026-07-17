import { Resend } from 'resend'
import { AirtableEvent, AirtableUser } from './airtable'
import { logDigestSend } from './supabase'
import { ratingUrl } from './email-rating'
import { withUtm } from './url'

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

// ----- After Hours email palette (inlined; CSS vars don't work in
// email clients). Subtler than the dark homepage: light cream body so
// Gmail / Outlook color-correction doesn't fight us, but the accent
// shifts from Salon oxblood (#6E1F2B) to a contrast-safe bronzed
// champagne (#8a6c2c) — the WCAG-AA-on-cream darker variant of the
// homepage's champagne (#c9a86a). Headlines move to Cormorant Garamond
// to match the homepage display serif. The diamond mark in the
// wordmark carries brand continuity.
const C = {
  bg:           '#F1ECE2',
  paper:        '#FBF8F1',
  paper2:       '#F6F1E5',
  ink:          '#1B1814',
  ink2:         '#4A433B',
  ink3:         '#8A8276',
  rule:         '#DDD3C0',
  ruleSoft:     '#E9E2D2',
  accent:       '#8a6c2c',
  accent2:      '#a0823a',
  accentSoft:   '#f3ecd9',
  diamond:      '#c9a86a',
}

// Cormorant Garamond display serif (homepage + emails). Sans stack is
// the system family — emails do not load the homepage's Hanken Grotesk.
const SERIF = `'Cormorant Garamond', Georgia, 'Times New Roman', serif`
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`

const FONT_LINK = `<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&display=swap" rel="stylesheet">`

const DASHBOARD_LINK = 'https://www.whisperedevents.com/dashboard'
const FAQ_LINK = 'https://www.whisperedevents.com/faq'
const HOST_LINK = 'https://www.whisperedevents.com/host'
const PARTNER_APPLY_LINK = 'https://www.whisperedevents.com/?apply=partner'

// Appends ?email=<encoded> when we know the recipient. The dashboard
// not-logged-in page reads this and pre-fills the magic-link form so
// users coming from email don't have to type their address.
function dashboardLinkFor(email?: string): string {
  const trimmed = email?.trim()
  if (!trimmed) return DASHBOARD_LINK
  return `${DASHBOARD_LINK}?email=${encodeURIComponent(trimmed)}`
}

// Single-pass swap of the bare DASHBOARD_LINK constant for the
// per-recipient version. Lets every email-template helper continue to
// reference DASHBOARD_LINK as a literal while still pre-filling the
// recipient's email in the URL. Apply to BOTH the HTML and plain-text
// bodies in each sender right before handing to Resend. No-op when
// no email is supplied (admin tooling, etc.).
function personalizeDashboardLinks(rendered: string, email?: string): string {
  const personal = dashboardLinkFor(email)
  if (personal === DASHBOARD_LINK) return rendered
  return rendered.split(DASHBOARD_LINK).join(personal)
}
const NEW_EVENT_MAILTO = 'mailto:event@whispered.com'

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
    <div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>
    ${inner}
  </div>
</div>
`.trim()
}

// Wordmark with diamond mark — matches the After Hours homepage
// header: champagne ♦, ink "Whispered", italic ink "Events". Cormorant
// 22 px so the wordmark reads as the brand stamp at the top of every
// transactional email.
function wordmark(): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;line-height:1;">
  <tr>
    <td style="vertical-align:middle;padding:0 9px 0 0;">
      <span style="display:inline-block;width:7px;height:7px;background:${C.diamond};transform:rotate(45deg);"></span>
    </td>
    <td style="vertical-align:middle;font-family:${SERIF};font-size:22px;font-weight:600;color:${C.ink};letter-spacing:.01em;">
      Whispered <span style="font-style:italic;color:${C.diamond};">Events</span>
    </td>
  </tr>
</table>
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

// Single-paragraph footer used at the bottom of every content email
// except the pre-approval send. Inline-styled (no border, no structured
// label list) so Gmail doesn't treat it as a repeated signature and
// auto-collapse it under a "..." indicator. Two CTAs: dashboard
// (preferences / pause) and event-share.
function digestFooterHtml(_firstName: string): string {
  return `
<p style="font-family:${SANS};font-size:13px;line-height:1.7;color:${C.ink3};margin:24px 0 0;">
  <strong style="color:${C.accent};">Improve your matches?</strong> <strong style="color:${C.ink};"><a href="${DASHBOARD_LINK}" style="color:${C.ink};text-decoration:underline;text-underline-offset:3px;">Visit your dashboard.</a></strong><br>
  <strong style="color:${C.accent};">Know an event we should add?</strong> <strong style="color:${C.ink};">Email <a href="${NEW_EVENT_MAILTO}" style="color:${C.ink};text-decoration:underline;text-underline-offset:3px;">event@whispered.com</a></strong>
</p>
`.trim()
}

function digestFooterTextLines(_firstName: string): string[] {
  return [
    `Improve your matches? Visit your dashboard: ${DASHBOARD_LINK}`,
    `Know an event we should add? Email event@whispered.com`,
  ]
}

// Inline truncation notice — rendered between the event list and the
// footer when the email shows fewer matches than the user actually has
// upcoming. Returns empty strings when there's nothing to truncate, so
// callers can drop the result into a template unconditionally.
function moreOnDashboardHtml(more: number): string {
  if (more <= 0) return ''
  const noun = more === 1 ? 'match' : 'matches'
  return `
<p style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.ink2};margin:20px 0 0;">
  You have <strong style="color:${C.ink};">${more} more ${noun}</strong> waiting — see them on <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">your dashboard</a> &rarr;
</p>
`.trim()
}

function moreOnDashboardTextLine(more: number): string {
  if (more <= 0) return ''
  const noun = more === 1 ? 'match' : 'matches'
  return `You have ${more} more ${noun} waiting — see them on your dashboard: ${DASHBOARD_LINK}`
}

// Per-send eyebrow date stamp (Mon DD in PT). Sits above the h1 so
// consecutive emails from us never share a byte-identical visible
// header zone — defeats Gmail's '...' trimmed-content collapse, which
// pattern-matches the above-the-fold chrome of recurring sends.
function todayEyebrow(): string {
  const d = new Date()
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'America/Los_Angeles' })
  const day = d.toLocaleString('en-US', { day: 'numeric', timeZone: 'America/Los_Angeles' })
  return `${month} ${day}`
}

// First-name-ish token for footers when only an email is available
// (event submission acks). Falls back to 'there'.
function firstNameFromEmail(email: string): string {
  const local = (email || '').split('@')[0] || ''
  const token = local.split(/[._-]/)[0] || ''
  if (!token) return 'there'
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
}

// ----- Transactional sends -----

export async function sendUserAppliedEmail(email: string): Promise<void> {
  const resend = getResend()
  const html = shell(`
    ${h1('Application <span style="font-style:italic;">received</span>.')}
    ${p("Thanks for applying to Whispered Events. We'll verify your LinkedIn profile and activate your account — typically within 24 hours. Once approved, you'll start seeing event matches personalized for you.", { mt: 14 })}
    ${p("Rating your matches helps us:", { mt: 14 })}
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:8px 0 0;">
      • <strong style="color:${C.ink};">Send you more matches:</strong> When you rate more we unlock the next match
    </p>
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:6px 0 0;">
      • <strong style="color:${C.ink};">Improve your matches:</strong> Our algorithm learns from your feedback
    </p>
    ${p(`We built Whispered Events for one reason: helping great people find the best events — the ones that aren't posted, they're whispered. Whispered Events will always be <strong style="color:${C.ink};">completely free for users</strong>. Help us grow and match you to even more events by:`, { mt: 14 })}
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:10px 0 0;">
      1. Sharing events to <a href="${NEW_EVENT_MAILTO}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">event@whispered.com</a>
    </p>
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:8px 0 0;">
      2. Posting about Whispered Events on LinkedIn (<a href="https://www.whisperedevents.com/love" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">see examples</a>)
    </p>
    ${signature()}
  `)
  const text = `Application received.

Thanks for applying to Whispered Events. We'll verify your LinkedIn profile and activate your account — typically within 24 hours. Once approved, you'll start seeing event matches personalized for you.

Rating your matches helps us:
• Send you more matches: When you rate more we unlock the next match
• Improve your matches: Our algorithm learns from your feedback

We built Whispered Events for one reason: helping great people find the best events — the ones that aren't posted, they're whispered. Whispered Events will always be completely free for users. Help us grow and match you to even more events by:
1. Sharing events to event@whispered.com
2. Posting about Whispered Events on LinkedIn (https://www.whisperedevents.com/love)

Andy (${ANDY_LINK})
Founder, Whispered`
  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: email,
    bcc: MONITOR_BCC,
    subject: 'Whispered Events — Application Received',
    html: personalizeDashboardLinks(html, email),
    text: personalizeDashboardLinks(text, email),
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
  const eb = todayEyebrow()
  const html = shell(`

    ${h1(`<span style="font-style:italic;">Welcome</span> to the club, ${escapeHtml(firstName)}.`)}
    ${p("You've been approved for Whispered Events. Login via the top right of the site to see your matches — matches typically appear within ~5 minutes of approval.", { mt: 14 })}
    ${p("You can update your profile anytime to refine your matches — and we &#10084; feedback and feature ideas.", { mt: 12 })}
    ${p("Whispered Events is 100% free, built to help executives discover great events — the ones that aren't posted, they're whispered.", { mt: 12 })}
    ${digestFooterHtml(firstName)}
  `)
  const text = [
    '',
    '',
    `Welcome to the club, ${firstName}.`,
    '',
    "You've been approved for Whispered Events. Login via the top right of the site to see your matches — matches typically appear within ~5 minutes of approval.",
    '',
    'You can update your profile anytime to refine your matches — and we love feedback and feature ideas.',
    '',
    "Whispered Events is 100% free, built to help executives discover great events — the ones that aren't posted, they're whispered.",
    '',
    ...digestFooterTextLines(firstName),
  ].join('\n')
  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    bcc: MONITOR_BCC,
    subject: "You're approved for Whispered Events",
    html: personalizeDashboardLinks(html, user.email),
    text: personalizeDashboardLinks(text, user.email),
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendUserApprovedEmail: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
}

// Contribution-milestone copy. Anniversaries get a celebratory line at
// the top of the body — top-contributor recognition matters more than
// a generic "thanks". Anything outside the milestone set falls back to
// the standard count line further down. Caller passes the running
// total post-insert, so 1 = first-ever contribution.
function contributionMilestone(total: number): string | null {
  switch (total) {
    case 1: return '🎉 This is your first contribution — welcome to the Whispered Events community!'
    case 5: return "🎉 5 events contributed — you're on a roll!"
    case 10: return '🎊 10 events contributed — top contributor territory!'
    case 25: return "🥂 25 events contributed — you're shaping the platform!"
    case 50: return '🚀 50 events contributed — power contributor!'
    case 100: return '👑 100 events contributed — legendary!'
    default: return null
  }
}

export async function sendEventSubmittedEmail(
  email: string,
  eventName: string,
  contributionsTotal: number,
  eventLink?: string,
): Promise<void> {
  const resend = getResend()
  const safeName = escapeHtml(eventName)
  const firstName = firstNameFromEmail(email)
  const milestone = contributionMilestone(contributionsTotal)
  const eventCountPhrase = `You've added ${contributionsTotal} event${contributionsTotal === 1 ? '' : 's'} so far! We'll be adding new features for top contributors soon.`
  const linkStyle = `color:${C.accent};text-decoration:underline;text-underline-offset:3px;`
  const eventNameHtml = eventLink
    ? `<a href="${escapeHtml(eventLink)}" style="${linkStyle}">"${safeName}"</a>`
    : `"${safeName}"`
  const summaryHtml = `<strong style="color:${C.ink};">${eventNameHtml}</strong> has been added. ${eventCountPhrase}`
  const summaryText = `"${eventName}" has been added. ${eventCountPhrase}${eventLink ? `\nEvent link: ${eventLink}` : ''}`
  // Inline links for the host / partner CTA. "reply to this email" framing
  // dropped because clicking the link is the canonical path now.
  const hostCtaHtml = `If you are the host of the event, <a href="${HOST_LINK}" style="${linkStyle}">get host access</a> by replying to this email.`
  const hostCtaText = `If you are the host of the event, get host access by replying to this email.`
  const html = shell(`
    ${h1(`Event <span style="font-style:italic;">added</span>.`)}
    ${p('Thanks for adding an event — Whispered Events is driven by contributions like yours!', { mt: 14 })}
    ${p(summaryHtml, { mt: 12 })}
    ${milestone ? p(`<strong style="color:${C.ink};">${milestone}</strong>`, { mt: 12 }) : ''}
    ${p(hostCtaHtml, { mt: 12 })}
    ${p('Enjoy your next event!', { mt: 12 })}
    ${digestFooterHtml(firstName)}
  `)
  const text = [
    'Event added.',
    '',
    'Thanks for adding an event — Whispered Events is driven by contributions like yours!',
    '',
    summaryText,
    '',
    ...(milestone ? [milestone, ''] : []),
    hostCtaText,
    '',
    'Enjoy your next event!',
    '',
    ...digestFooterTextLines(firstName),
  ].join('\n')
  const { error } = await resend.emails.send({
    from: EVENT_FROM,
    to: email,
    bcc: MONITOR_BCC,
    subject: `Event added — ${eventName}`,
    html: personalizeDashboardLinks(html, email),
    text: personalizeDashboardLinks(text, email),
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendEventSubmittedEmail: Resend error', { email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
}

// Rating notifications are now sent to Slack (lib/slack.ts notifyMatchRating).
// This stub is kept so existing call sites don't need to change imports —
// they already import from here and pass the same params.
export async function sendMatchRatingNotification(params: {
  userId: string
  userName: string
  userEmail: string
  userLinkedin: string | null
  eventName: string
  rating: 'interested' | 'skip' | 'not_a_fit'
  reason: string | null
}): Promise<void> {
  const { notifyMatchRating } = await import('./slack')
  await notifyMatchRating(params)
}

// Host rating notifications are now sent to Slack (lib/slack.ts notifyHostMatchRating).
export async function sendHostMatchRatingNotification(params: {
  hostId: string
  hostName: string
  hostEmail: string
  hostLinkedin: string | null
  guestName: string
  guestUserId: string
  guestEmail: string | null
  guestLinkedin: string | null
  eventName: string
  eventId: string
  rating: 'up' | 'down'
  feedback: string | null
}): Promise<void> {
  const { notifyHostMatchRating } = await import('./slack')
  await notifyHostMatchRating(params)
}

// Injects inline color + underline + target="_blank" onto every <a>
// tag in admin-composed blast body HTML. The WYSIWYG produces clean
// <a href="..."> tags without styling, and because the wrapper div
// sets color:var(--ink-2), most email clients cascade that color into
// the <a> and strip the browser-default blue + underline. Result: the
// link is technically there but looks identical to surrounding text.
// Inline styles defeat the cascade so the link reads as a link.
function decorateLinks(html: string): string {
  return html.replace(/<a\b([^>]*?)>/gi, (_, attrs: string) => {
    const hasStyle = /\sstyle\s*=/i.test(attrs)
    const hasTarget = /\starget\s*=/i.test(attrs)
    let out = attrs
    if (!hasStyle) {
      out += ` style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;"`
    }
    if (!hasTarget) {
      out += ' target="_blank" rel="noopener noreferrer"'
    }
    return `<a${out}>`
  })
}

// Admin-composed broadcast. Body is HTML produced by the WYSIWYG
// editor on /admin/blast (paragraphs, lists, links, bold, italic).
// {{firstName}} is substituted per recipient before rendering. Wraps
// the body in the Salon shell with the digest footer (unsubscribe path
// is dashboard frequency=Paused).
export async function sendBlast(
  user: AirtableUser,
  subject: string,
  bodyHtml: string,
): Promise<void> {
  const resend = getResend()
  const firstName = firstNameOrThere(user)
  const substituted = bodyHtml
    .replaceAll('{{firstName}}', escapeHtml(firstName))
    .replaceAll('{{location}}', escapeHtml(user.location || ''))
    .replaceAll('{{interests}}', escapeHtml(user.interest || ''))

  const decorated = decorateLinks(substituted)

  const html = shell(`
    <div style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};">
      ${decorated}
    </div>
    ${digestFooterHtml(firstName)}
  `)
  const text = [htmlToText(decorated), '', ...digestFooterTextLines(firstName)].join('\n')

  // Blasts deliberately skip the MONITOR_BCC. Sends fan out to dozens
  // of users at a time and Andy's inbox doesn't need a duplicate of
  // each. Resend's dashboard is the audit trail.
  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    subject,
    html: personalizeDashboardLinks(html, user.email),
    text: personalizeDashboardLinks(text, user.email),
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendBlast: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
  await logDigestSend({
    userId: user.id,
    userEmail: user.email,
    kind: 'blast',
    eventIds: [],
  })
}

// Best-effort HTML → plain text for the multipart text/plain part. Keeps
// list bullets readable and inserts blank lines between paragraphs.
function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<\/(ul|ol|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Cron-fired nudge for dormant users — those with no matching events in
// their pipeline. Branches on whether they have ANY future events within
// range of their location:
//   nearbyCount === 0 → Variant A (we have nothing in their area)
//   nearbyCount >= 1 → Variant B (we have events nearby but their
//                                 interests / profile aren't matching)
// Caller (lib/digest.ts) is responsible for the eligibility check
// (grade != B/C, frequency != Paused, 28-day floor). BCC andy on every
// send, log to digest_sends with kind='coaching' so the floor includes
// past coaching nudges.
export async function sendCoaching(
  user: AirtableUser,
  nearbyCount: number,
): Promise<void> {
  const resend = getResend()
  const firstName = firstNameOrThere(user)
  const safeName = escapeHtml(firstName)
  const safeLocation = escapeHtml(user.location || '')

  const { subject, html, text } =
    nearbyCount === 0
      ? renderCoachingNoNearby(safeName, safeLocation, firstName)
      : renderCoachingNoMatches(safeName, safeLocation, nearbyCount, firstName)

  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    bcc: MONITOR_BCC,
    subject,
    html: personalizeDashboardLinks(html, user.email),
    text: personalizeDashboardLinks(text, user.email),
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendCoaching: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
  await logDigestSend({
    userId: user.id,
    userEmail: user.email,
    kind: 'coaching',
    eventIds: [],
  })
}

function renderCoachingNoNearby(
  safeName: string,
  safeLocation: string,
  firstName: string,
): { subject: string; html: string; text: string } {
  const locationPhrase = safeLocation || 'your area'
  const subject = `No Whispered Events near you yet — let's change that`
  const eb = todayEyebrow()
  // Gmail was collapsing the body behind a '...' indicator when the
  // CTAs were inside an <ol>. Splitting them into discrete <p>
  // elements with manual numbering keeps the look but flat content
  // doesn't trigger the quoted-content heuristic.
  const html = shell(`

    ${h1(`Hi <span style="font-style:italic;">${safeName}</span>.`)}
    ${p(
      `We don't have any upcoming Whispered Events near ${locationPhrase} yet. Two quick ways to change that:`,
      { mt: 14 },
    )}
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:14px 0 0;">
      <strong style="color:${C.ink};">1. Help us build a presence in ${locationPhrase}</strong> — share events you see, email any link to <a href="${NEW_EVENT_MAILTO}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">event@whispered.com</a> and we'll add it in!
    </p>
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:10px 0 0;">
      <strong style="color:${C.ink};">2. Update your location</strong> on your <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">dashboard</a> if you've moved or are traveling — your matches will re-run automatically.
    </p>
    ${digestFooterHtml(firstName)}
  `)
  const text = [
    '',
    '',
    `Hi ${safeName}.`,
    '',
    `We don't have any upcoming Whispered Events near ${locationPhrase} yet. Two quick ways to change that:`,
    '',
    `1. Help us build a presence in ${locationPhrase} — share events you see, email any link to event@whispered.com and we'll add it in!`,
    `2. Update your location on your dashboard if you've moved or are traveling — your matches will re-run automatically.`,
    '',
    ...digestFooterTextLines(firstName),
  ].join('\n')
  return { subject, html, text }
}

function renderCoachingNoMatches(
  safeName: string,
  safeLocation: string,
  nearbyCount: number,
  firstName: string,
): { subject: string; html: string; text: string } {
  const locationPhrase = safeLocation || 'you'
  const noun = nearbyCount === 1 ? 'event' : 'events'
  const subject = `${nearbyCount} ${noun} near you — let's tune your matches`
  const eb = todayEyebrow()
  // Same anti-collapse rewrite as Variant A: discrete <p> elements
  // instead of <ol>/<li> so Gmail doesn't hide the CTAs behind '...'.
  const html = shell(`

    ${h1(`Hi <span style="font-style:italic;">${safeName}</span>.`)}
    ${p(
      `We have ${nearbyCount} upcoming ${noun} near ${locationPhrase}, but none are matching your profile yet. Two ways to fix that:`,
      { mt: 14 },
    )}
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:14px 0 0;">
      <strong style="color:${C.ink};">1. Update your profile</strong> on your <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">dashboard</a> — update the function we pulled from LinkedIn and your topics you are interested in.
    </p>
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:10px 0 0;">
      <strong style="color:${C.ink};">2. Share events in topics you care about</strong> — email any link to <a href="${NEW_EVENT_MAILTO}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">event@whispered.com</a> to help build momentum.
    </p>
    ${digestFooterHtml(firstName)}
  `)
  const text = [
    '',
    '',
    `Hi ${safeName}.`,
    '',
    `We have ${nearbyCount} upcoming ${noun} near ${locationPhrase}, but none are matching your profile yet. Two ways to fix that:`,
    '',
    `1. Update your profile on your dashboard — update the function we pulled from LinkedIn and your topics you are interested in.`,
    `2. Share events in topics you care about — email any link to event@whispered.com to help build momentum.`,
    '',
    ...digestFooterTextLines(firstName),
  ].join('\n')
  return { subject, html, text }
}

// Recap nudge for users who DO match events but don't have anything
// new for us to tell them about (already notified on every match).
// Same 28-day floor as coaching applies — the caller in lib/digest.ts
// gates this via isCoachingEligible. The recap shows the top 3 of
// their already-matched events plus the nearby/match counts so they
// have context for why they aren't hearing more.
export async function sendRecap(
  user: AirtableUser,
  topMatches: DigestEventEntry[],
  nearbyCount: number,
  totalMatchCount: number,
): Promise<void> {
  if (topMatches.length === 0) return
  const resend = getResend()
  const firstName = firstNameOrThere(user)
  const safeName = escapeHtml(firstName)
  const safeLocation = escapeHtml(user.location || '')
  const locationPhrase = safeLocation || 'your area'
  const matchNoun = totalMatchCount === 1 ? 'event' : 'events'
  const matchVerb = totalMatchCount === 1 ? 'matches' : 'match'
  const nearbyNoun = nearbyCount === 1 ? 'event' : 'events'

  const subject = `Your top Whispered Events ${totalMatchCount === 1 ? 'match' : 'matches'}`
  const eb = todayEyebrow()

  // The 'New' section is omitted because none of these are new — it's
  // a recap of already-notified rows. We use the Top Matches section
  // styling so the layout reads as a normal digest body.
  const annotated = markDuplicates({ newEvents: [], topMatches })

  const html = shell(`

    ${h1(`Hi <span style="font-style:italic;">${safeName}</span>.`)}
    ${p(
      `Quick recap — we have ${nearbyCount} upcoming ${nearbyNoun} near ${locationPhrase}, and your profile ${matchVerb} ${totalMatchCount} of them. Here are your top ${matchNoun}:`,
      { mt: 14 },
    )}
    ${renderEntries(annotated.topMatches, user.id)}
    ${p(
      `Want to see more? Update your interests on your <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">dashboard</a> — add functions or topics you'd like to see (e.g. "RevOps", "GTM", "AI", specific industries).`,
      { mt: 14 },
    )}
    ${digestFooterHtml(firstName)}
  `)

  const textLines: string[] = [
    '',
    '',
    `Hi ${firstName}.`,
    '',
    `Quick recap — we have ${nearbyCount} upcoming ${nearbyNoun} near ${user.location || 'your area'}, and your profile ${matchVerb} ${totalMatchCount} of them. Here are your top ${matchNoun}:`,
    '',
  ]
  for (const entry of annotated.topMatches) {
    const { event, matchPercent, isDuplicate } = entry
    const date = shortDate(event.date)
    const city = cityFromLocation(event.location)
    const datePart = date ? ` (${date}${city ? ` ${city}` : ''} - ${Math.round(matchPercent)}% Match)` : ` (${Math.round(matchPercent)}% Match)`
    const body = isDuplicate ? ' see above' : event.description ? ` ${event.description}` : ''
    textLines.push(`${event.name}${datePart}${body}`)
    textLines.push(event.link)
    textLines.push('')
  }
  textLines.push(
    `Want to see more? Update your interests on your dashboard — ${DASHBOARD_LINK}`,
    '',
    ...digestFooterTextLines(firstName),
  )

  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    bcc: MONITOR_BCC,
    subject,
    html: personalizeDashboardLinks(html, user.email),
    text: personalizeDashboardLinks(textLines.join('\n'), user.email),
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendRecap: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
  await logDigestSend({
    userId: user.id,
    userEmail: user.email,
    kind: 'recap',
    eventIds: topMatches.map((e) => e.event.id),
  })
}

export async function sendEventCouldNotReadEmail(email: string, submittedUrl?: string): Promise<void> {
  const resend = getResend()
  const firstName = firstNameFromEmail(email)
  const urlHtml = submittedUrl
    ? p(`Link you sent: <a href="${escapeHtml(submittedUrl)}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">${escapeHtml(submittedUrl)}</a>`, { mt: 12 })
    : ''
  const urlText = submittedUrl ? `\nLink you sent: ${submittedUrl}\n` : ''
  const html = shell(`
    ${h1(`We couldn't <span style="font-style:italic;">read</span> your event.`)}
    ${p('Thanks for sending an event to Whispered Events — the platform is powered by contributions like yours.', { mt: 14 })}
    ${p("We weren't able to extract the event details.", { mt: 12 })}
    ${urlHtml}
    ${p("If you have a public event link (Luma, Eventbrite, the host's site, etc.), send it over and we'll try again.", { mt: 12 })}
    ${digestFooterHtml(firstName)}
  `)
  const text = [
    "We couldn't read your event.",
    '',
    'Thanks for sending an event to Whispered Events — the platform is powered by contributions like yours.',
    '',
    "We weren't able to extract the event details.",
    urlText,
    "If you have a public event link (Luma, Eventbrite, the host's site, etc.), send it over and we'll try again.",
    '',
    ...digestFooterTextLines(firstName),
  ].join('\n')
  const { error } = await resend.emails.send({
    from: EVENT_FROM,
    to: email,
    bcc: MONITOR_BCC,
    subject: "We couldn't read your event",
    html: personalizeDashboardLinks(html, email),
    text: personalizeDashboardLinks(text, email),
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendEventCouldNotReadEmail: Resend error', { email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
}

export async function sendDroppedEmailNotification(params: {
  reason: string
  originalFrom: string
  originalSubject: string
  originalBody: string
  urlFound: string | undefined
  autoSubmittedHeader?: string
}): Promise<void> {
  const resend = getResend()
  const safeFrom = escapeHtml(params.originalFrom)
  const safeSubject = escapeHtml(params.originalSubject || '(no subject)')
  const safeUrl = params.urlFound ? escapeHtml(params.urlFound) : null
  const safeBody = escapeHtml(params.originalBody.slice(0, 3000))
  const urlRow = safeUrl
    ? `<p style="margin:8px 0 0;"><strong>URL found:</strong> <a href="${safeUrl}" style="color:#c9a86a;">${safeUrl}</a></p>`
    : `<p style="margin:8px 0 0;color:#888;"><em>No URL found in email</em></p>`
  const autoHeader = params.autoSubmittedHeader
    ? `<p style="margin:8px 0 0;"><strong>Auto-Submitted header:</strong> <code>${escapeHtml(params.autoSubmittedHeader)}</code></p>`
    : ''
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#1b1814;color:#ece6da;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#251e19;border:1px solid rgba(201,168,106,0.2);border-radius:8px;padding:24px;">
    <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#c9a86a;">⚠️ Inbound event email dropped</p>
    <p style="margin:0 0 8px;"><strong>Reason:</strong> <code>${escapeHtml(params.reason)}</code></p>
    <p style="margin:8px 0 0;"><strong>From:</strong> ${safeFrom}</p>
    <p style="margin:8px 0 0;"><strong>Subject:</strong> ${safeSubject}</p>
    ${urlRow}
    ${autoHeader}
    <hr style="border:none;border-top:1px solid rgba(201,168,106,0.2);margin:16px 0;">
    <p style="margin:0 0 8px;font-size:12px;color:#9c8b7e;text-transform:uppercase;letter-spacing:.06em;">Original email body</p>
    <pre style="margin:0;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:#c8b89a;background:rgba(0,0,0,0.3);padding:12px;border-radius:4px;border:1px solid rgba(201,168,106,0.1);">${safeBody}</pre>
  </div>
</div>`.trim()
  const text = [
    `Inbound event email dropped`,
    `Reason: ${params.reason}`,
    `From: ${params.originalFrom}`,
    `Subject: ${params.originalSubject || '(no subject)'}`,
    `URL found: ${params.urlFound ?? 'none'}`,
    params.autoSubmittedHeader ? `Auto-Submitted header: ${params.autoSubmittedHeader}` : '',
    '',
    '--- Original email body ---',
    params.originalBody.slice(0, 3000),
  ].filter((l) => l !== null).join('\n')

  try {
    const { error } = await resend.emails.send({
      from: EVENT_FROM,
      to: 'andy@whispered.com',
      subject: `[Event email drop] ${params.reason} — from ${params.originalFrom}`,
      html,
      text,
      headers: AUTO_HEADERS,
    })
    if (error) console.error('sendDroppedEmailNotification: Resend error', error)
  } catch (e) {
    console.error('sendDroppedEmailNotification failed', e)
  }
}

export async function sendMagicLink(email: string, token: string, baseUrl: string, next?: string): Promise<void> {
  const resend = getResend()
  // /auth/login is a passive interstitial — it never consumes the
  // token on its own. The user clicks "Sign me in" there to POST to
  // /api/auth/verify, which is what actually creates the session.
  // Pointing the email at /auth/login (not the API route) means email
  // security scanners that prefetch URLs can't accidentally burn the
  // token before the recipient clicks.
  // `next` is forwarded into the interstitial's hidden form so the
  // verify route lands the user on the page that requested the login
  // (e.g. /host) rather than the default /dashboard.
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : ''
  const link = `${baseUrl}/auth/login?token=${token}${nextParam}`
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

// Sent automatically when a host is assigned to an event in the admin panel.
// Goes to the newly-added host(s); existing hosts are not re-notified.
export async function sendHostAddedEmail(params: {
  hostEmail: string
  hostFirstName: string
  eventName: string
  eventId: string
}): Promise<void> {
  const resend = getResend()
  const { hostEmail, hostFirstName, eventName, eventId } = params
  const firstName = hostFirstName || firstNameFromEmail(hostEmail)
  const safeName = escapeHtml(firstName)
  const safeEventName = escapeHtml(eventName)
  const eventHostLink = `${HOST_LINK}/${eventId}`
  const html = shell(`
    ${h1(`You're now a host for <em style="color:${C.diamond};font-style:italic;">${safeEventName}</em>.`)}
    ${p(`Hi ${safeName} — we've added you as a host for <strong style="color:${C.ink};">${safeEventName}</strong>. You can now view who we've matched to this event in your host dashboard.`, { mt: 14 })}
    ${accentButton(eventHostLink, 'View matches')}
    ${p(`To refine targeting / update any of the criteria, just reply to this email with any changes and we'll update them for you.`, { mt: 16 })}
    ${signature()}
  `)
  const text = [
    `You're now a host for ${eventName}.`,
    '',
    `Hi ${firstName} — we've added you as a host for ${eventName}. You can now view who we've matched to this event in your host dashboard.`,
    '',
    `View matches → ${eventHostLink}`,
    '',
    `To refine targeting / update any of the criteria, just reply to this email with any changes and we'll update them for you.`,
    '',
    `Andy (${ANDY_LINK})`,
    `Founder, Whispered`,
  ].join('\n')
  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: hostEmail,
    bcc: MONITOR_BCC,
    subject: `You're now a host for ${eventName}`,
    html,
    text,
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendHostAddedEmail: Resend error', { email: hostEmail, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
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
  // Total count of the user's future, above-threshold matches at
  // send time. When > newEvents.length, the email renders an
  // inline "you have N more matches — see your dashboard" line so
  // users with backlogs at least know the truncation exists. When
  // omitted or equal to newEvents.length the line is hidden.
  totalUpcomingMatches?: number
  // Number of never-rated matches beyond the 7-slot cap. When > 0,
  // a nudge line is appended after the match list.
  lockedCount?: number
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

function cityFromLocation(location: string): string {
  if (!location) return ''
  return location.split(',')[0].trim()
}

function renderEntry(entry: DigestEventEntry, userId: string, baseUrl: string): string {
  const { event, matchPercent, isDuplicate } = entry
  const date = shortDate(event.date)
  const city = cityFromLocation(event.location)
  // Dates: bold but neutral (ink-2) — readers used to ignore them
  // when they were oxblood because the link itself wasn't tinted.
  const matchStr = `${Math.round(matchPercent)}% Match`
  const datePart = date
    ? `<strong style="color:${C.ink2};font-variant-numeric:tabular-nums;"> (${date}${city ? ` ${escapeHtml(city)}` : ''} - ${matchStr})</strong> `
    : `<strong style="color:${C.ink2};"> (${matchStr})</strong> `
  const body = isDuplicate
    ? `<em style="color:${C.ink3};">see above</em> `
    : event.description
      ? `<span style="color:${C.ink2};">${escapeHtml(event.description)}</span> `
      : ''

  const interestedUrl = ratingUrl(userId, event.id, 'interested', baseUrl)
  const skipUrl = ratingUrl(userId, event.id, 'skip', baseUrl)
  const notFitUrl = ratingUrl(userId, event.id, 'not_a_fit', baseUrl)
  // SVG is stripped by Gmail/Outlook — use Unicode symbols instead.
  // U+1F4C5 (📅) and emoji are excluded; these plain-text symbols inherit
  // the anchor's color and render reliably across all major clients.
  const btnBase = 'border-radius:99px;padding:4px 12px;font-size:12px;text-decoration:none;display:inline-block;margin-right:6px;white-space:nowrap;font-weight:500;border:1px solid;'
  // ✓ U+2713, ♡ U+2661 (outline heart, not emoji), ✕ U+2715 —
  // plain Unicode symbols that inherit the anchor color in all major clients.
  const ratingHtml = [
    `<a href="${interestedUrl}" style="${btnBase}background:rgba(45,106,79,0.10);color:#2D6A4F;border-color:rgba(45,106,79,0.35);">&#10003; Interested</a>`,
    `<a href="${skipUrl}" style="${btnBase}background:rgba(58,95,138,0.10);color:#3A5F8A;border-color:rgba(58,95,138,0.35);">&#9825; Skip</a>`,
    `<a href="${notFitUrl}" style="${btnBase}background:rgba(138,42,56,0.10);color:#8A2A38;border-color:rgba(201,129,140,0.35);">&#10005; Not a fit</a>`,
  ].join('')

  // Event title: oxblood + underlined so the click affordance is
  // obvious. text-underline-offset matches the rest of the email's
  // link treatment.
  return `
<p style="font-family:${SANS};margin:0;font-size:14.5px;line-height:1.55;">
  <a href="${withUtm(event.link)}" style="font-family:${SERIF};font-size:17px;color:${C.accent};text-decoration:underline;text-underline-offset:3px;font-weight:400;letter-spacing:-0.01em;">${escapeHtml(event.name)}</a>${datePart}${body}<br><span style="display:inline-block;margin-top:4px;">${ratingHtml}</span>
</p>
<div style="margin-bottom:20px;"></div>
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

const EMAIL_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://whisperedevents.com'

function renderEntries(entries: DigestEventEntry[], userId: string): string {
  if (!entries.length) return ''
  return `<div style="margin-top:22px;">${entries.map((e) => renderEntry(e, userId, EMAIL_BASE_URL)).join('')}</div>`
}

export async function sendApprovedWithDigest(
  user: AirtableUser,
  payload: DigestPayload,
  nearbyCount?: number,
): Promise<void> {
  const resend = getResend()
  const firstName = firstNameOrThere(user)
  const hasMatches = payload.newEvents.length > 0 || payload.topMatches.length > 0
  const annotated = markDuplicates(payload)

  // When the new user has no matches yet but is coaching-eligible
  // (A/Polish grade — B/C never get coaching, see lib/digest.ts), fold
  // the coaching CTAs into the welcome itself rather than waiting until
  // the next Monday cron. nearbyCount steers which variant we use.
  const isCoachingEligible = user.grade !== 'B' && user.grade !== 'C'
  const includeCoaching = !hasMatches && isCoachingEligible && nearbyCount !== undefined
  const coachingHtml = includeCoaching
    ? renderInlineCoaching(escapeHtml(user.location || ''), nearbyCount)
    : ''
  const coachingTextLines = includeCoaching
    ? inlineCoachingTextLines(user.location || '', nearbyCount)
    : []

  const baseIntro = hasMatches
    ? "You've been approved for Whispered Events. Here are your first matches:"
    : includeCoaching
      ? null
      : "You've been approved for Whispered Events."

  const coachingIntroHtml = `You've been approved for Whispered Events. We don't have matching events in your region yet (<a href="${FAQ_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">see how we match</a>) — here are two quick ways to fix that:`
  const coachingIntroText = `You've been approved for Whispered Events. We don't have matching events in your region yet (see how we match: ${FAQ_LINK}) — here are two quick ways to fix that:`

  const introCopyHtml = baseIntro ?? coachingIntroHtml
  const introCopyText = baseIntro ?? coachingIntroText

  // Inline truncation note — surfaces remaining matches that didn't
  // fit in the top-3 cap. Falls back to '' when nothing was truncated.
  const moreCount = Math.max(
    0,
    (payload.totalUpcomingMatches ?? 0) - annotated.newEvents.length,
  )
  const moreHtml = moreOnDashboardHtml(moreCount)
  const moreText = moreOnDashboardTextLine(moreCount)

  const eb = todayEyebrow()
  const ratingNudgeHtml = `
    <div style="margin-top:16px;padding:14px 18px;background:${C.accentSoft};border:1px solid ${C.rule};border-radius:6px;">
      <p style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.ink2};margin:0 0 10px;">
        Rating your matches (
        <span style="display:inline-block;margin:0 3px;padding:2px 8px;border-radius:99px;background:rgba(45,106,79,0.10);color:#2D6A4F;border:1px solid rgba(45,106,79,0.35);font-size:12px;">&#10003;</span>
        <span style="display:inline-block;margin:0 3px;padding:2px 8px;border-radius:99px;background:rgba(58,95,138,0.10);color:#3A5F8A;border:1px solid rgba(58,95,138,0.35);font-size:12px;">&#9825;</span>
        <span style="display:inline-block;margin:0 3px;padding:2px 8px;border-radius:99px;background:rgba(138,42,56,0.10);color:#8A2A38;border:1px solid rgba(201,129,140,0.35);font-size:12px;">&#10005;</span>
        ) helps us:
      </p>
      <p style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.ink2};margin:0 0 6px;">
        • <strong style="color:${C.ink};">Send you more matches:</strong> When you rate more we unlock the next match
      </p>
      <p style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.ink2};margin:0;">
        • <strong style="color:${C.ink};">Improve your matches:</strong> Our algorithm learns from your feedback
      </p>
    </div>
  `

  const html = shell(`

    ${h1(`<span style="font-style:italic;">Welcome</span> to the club, ${escapeHtml(firstName)}.`)}
    ${p(introCopyHtml, { mt: 14 })}
    ${ratingNudgeHtml}
    ${renderEntries(annotated.newEvents, user.id)}
    ${moreHtml}
    ${coachingHtml}
    ${digestFooterHtml(firstName)}
  `)

  const textLines: string[] = [
    '',
    '',
    `Welcome to the club, ${firstName}.`,
    '',
    introCopyText,
    '',
    'Rating your matches helps us:',
    '• Send you more matches: When you rate more we unlock the next match',
    '• Improve your matches: Our algorithm learns from your feedback',
    '',
  ]
  const appendEntries = (entries: DigestEventEntry[]) => {
    if (!entries.length) return
    for (const entry of entries) {
      const { event, matchPercent, isDuplicate } = entry
      const date = shortDate(event.date)
      const city = cityFromLocation(event.location)
      const datePart = date ? ` (${date}${city ? ` ${city}` : ''} - ${Math.round(matchPercent)}% Match)` : ` (${Math.round(matchPercent)}% Match)`
      const body = isDuplicate ? ' see above' : event.description ? ` ${event.description}` : ''
      textLines.push(`${event.name}${datePart}${body}`)
      textLines.push(withUtm(event.link))
      textLines.push('')
    }
  }
  appendEntries(annotated.newEvents)
  if (moreText) textLines.push(moreText, '')
  if (coachingTextLines.length) {
    textLines.push(...coachingTextLines, '')
  }
  textLines.push(...digestFooterTextLines(firstName))
  const text = textLines.join('\n')

  const subject = hasMatches
    ? 'Welcome to Whispered Events — your first matches'
    : "You're approved for Whispered Events"

  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    bcc: MONITOR_BCC,
    subject,
    html: personalizeDashboardLinks(html, user.email),
    text: personalizeDashboardLinks(text, user.email),
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendApprovedWithDigest: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
  // Log every welcome send — even no-match welcomes — so the 28-day
  // coaching floor (lib/digest.ts) knows we just touched this user.
  const eventIds = hasMatches
    ? Array.from(new Set(annotated.newEvents.map((e) => e.event.id)))
    : []
  await logDigestSend({
    userId: user.id,
    userEmail: user.email,
    kind: 'welcome',
    eventIds,
  })
}

// Sent when a user updates their location on the dashboard and the
// re-scoring surfaces new events above threshold. Mirrors the welcome
// template shape — same header tone, same renderEntries, same
// truncation pointer — but with location-specific framing and a
// subject line that names the new city. Caller is expected to have
// already verified that newEvents.length > 0; this function does not
// guard against empty newEvents (Resend would just send an empty
// digest).
export async function sendLocationUpdatedDigest(
  user: AirtableUser,
  payload: DigestPayload,
  newLocation: string,
): Promise<void> {
  if (!payload.newEvents.length) return
  const resend = getResend()
  const firstName = firstNameOrThere(user)
  const annotated = markDuplicates(payload)
  const cityLabel = newLocation.trim() || 'your area'

  const moreCount = Math.max(
    0,
    (payload.totalUpcomingMatches ?? 0) - annotated.newEvents.length,
  )
  const moreHtml = moreOnDashboardHtml(moreCount)
  const moreText = moreOnDashboardTextLine(moreCount)

  const eb = todayEyebrow()
  const introCopy = `We saw you just updated your location to ${cityLabel} — here are upcoming events that match your profile.`

  const html = shell(`

    ${h1(`New <span style="font-style:italic;">whispers</span> in ${escapeHtml(cityLabel)}, ${escapeHtml(firstName)}.`)}
    ${p(introCopy, { mt: 14 })}
    ${renderEntries(annotated.newEvents, user.id)}
    ${moreHtml}
    ${digestFooterHtml(firstName)}
  `)

  const textLines: string[] = [
    '',
    '',
    `New whispers in ${cityLabel}, ${firstName}.`,
    '',
    introCopy,
    '',
  ]
  const appendEntries = (entries: DigestEventEntry[]) => {
    if (!entries.length) return
    for (const entry of entries) {
      const { event, matchPercent, isDuplicate } = entry
      const date = shortDate(event.date)
      const city = cityFromLocation(event.location)
      const datePart = date ? ` (${date}${city ? ` ${city}` : ''} - ${Math.round(matchPercent)}% Match)` : ` (${Math.round(matchPercent)}% Match)`
      const body = isDuplicate ? ' see above' : event.description ? ` ${event.description}` : ''
      textLines.push(`${event.name}${datePart}${body}`)
      textLines.push(withUtm(event.link))
      textLines.push('')
    }
  }
  appendEntries(annotated.newEvents)
  if (moreText) textLines.push(moreText, '')
  textLines.push(...digestFooterTextLines(firstName))
  const text = textLines.join('\n')

  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    bcc: MONITOR_BCC,
    subject: `New matches in ${cityLabel}`,
    html: personalizeDashboardLinks(html, user.email),
    text: personalizeDashboardLinks(text, user.email),
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendLocationUpdatedDigest: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
  const eventIds = Array.from(new Set(annotated.newEvents.map((e) => e.event.id)))
  await logDigestSend({
    userId: user.id,
    userEmail: user.email,
    kind: 'cron',
    eventIds,
  })
}

// Inline coaching block reused inside the welcome email. Mirrors the
// standalone sendCoaching templates so a new user with no matches sees
// the same guidance the Monday cron would send them later.
function renderInlineCoaching(safeLocation: string, nearbyCount: number): string {
  if (nearbyCount === 0) {
    const locationPhrase = safeLocation || 'your area'
    return `
<p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:14px 0 0;">
  <strong style="color:${C.ink};">1. Update your location</strong> on your <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">dashboard</a> — shift to a different location, maybe a top-tier city where you're traveling to for events.
</p>
<p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:10px 0 0;">
  <strong style="color:${C.ink};">2. Help us build the flywheel in ${locationPhrase}</strong> — share events you see, email any link to <a href="${NEW_EVENT_MAILTO}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">event@whispered.com</a> and we'll add it in!
</p>
`.trim()
  }
  const locationPhrase = safeLocation || 'you'
  const noun = nearbyCount === 1 ? 'event' : 'events'
  return `
<p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:14px 0 0;">We do have ${nearbyCount} upcoming ${noun} near ${locationPhrase} — your profile just isn't matching them yet. <strong style="color:${C.ink};">1. Update your profile</strong> on your <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">dashboard</a>: Update the function we pulled from LinkedIn and your topics you are interested in. And you can change your location if you are travelling.</p>
<p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:10px 0 0;">
  <strong style="color:${C.ink};">2. Help us build the flywheel:</strong> Share events by emailing the link to <a href="${NEW_EVENT_MAILTO}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">event@whispered.com</a>.
</p>
`.trim()
}

function inlineCoachingTextLines(location: string, nearbyCount: number): string[] {
  if (nearbyCount === 0) {
    const locationPhrase = location || 'your area'
    return [
      `1. Update your location on your dashboard — shift to a different location, maybe a top-tier city where you're traveling to for events.`,
      `2. Help us build the flywheel in ${locationPhrase} — share events you see, email any link to event@whispered.com and we'll add it in!`,
    ]
  }
  const locationPhrase = location || 'you'
  const noun = nearbyCount === 1 ? 'event' : 'events'
  return [
    `We do have ${nearbyCount} upcoming ${noun} near ${locationPhrase} — your profile just isn't matching them yet.`,
    '',
    `1. Update your profile on your dashboard: Update the function we pulled from LinkedIn and your topics you are interested in. And you can change your location if you are travelling.`,
    `2. Help us build the flywheel: Share events by emailing the link to event@whispered.com.`,
  ]
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

  // Per-event ('as they arrive') sends carry a single fresh event and
  // fire near-real-time — there's no 'week of X' framing and the
  // 'some matches' plural reads wrong. Cron digests bundle multiple
  // events on a weekly clock, where both make sense.
  const isPerEvent = kind === 'per_event'
  const eb = todayEyebrow()
  const eyebrowMarkup = isPerEvent ? '' : ''
  const introCopy = isPerEvent
    ? 'We have a new matching event for you.'
    : 'We have some new matching Whispered Events for you.'

  // Inline truncation note. For per-event this captures the user's
  // backlog (rendered email shows just the triggering event, the
  // dashboard has any others). For cron digests it captures the
  // unnotified+notified upcoming matches beyond the rendered 3.
  const moreCount = Math.max(
    0,
    (payload.totalUpcomingMatches ?? 0) - annotated.newEvents.length,
  )
  const moreHtml = moreOnDashboardHtml(moreCount)
  const moreText = moreOnDashboardTextLine(moreCount)

  const lockedNudgeHtml = (payload.lockedCount ?? 0) > 0
    ? `<p style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.ink2};margin:20px 0 0;"><strong style="color:${C.ink};">You have ${payload.lockedCount} more match${(payload.lockedCount ?? 0) === 1 ? '' : 'es'} waiting.</strong> Rate your current matches to unlock them — <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">view your dashboard →</a></p>`
    : ''
  const lockedNudgeText = (payload.lockedCount ?? 0) > 0
    ? `You have ${payload.lockedCount} more match${(payload.lockedCount ?? 0) === 1 ? '' : 'es'} waiting. Rate your current matches to unlock them — ${DASHBOARD_LINK}`
    : ''

  const digestRatingNudgeHtml = `
    <div style="margin-top:16px;padding:14px 18px;background:${C.accentSoft};border:1px solid ${C.rule};border-radius:6px;">
      <p style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.ink2};margin:0 0 10px;">
        Rating your matches (
        <span style="display:inline-block;margin:0 3px;padding:2px 8px;border-radius:99px;background:rgba(45,106,79,0.10);color:#2D6A4F;border:1px solid rgba(45,106,79,0.35);font-size:12px;">&#10003;</span>
        <span style="display:inline-block;margin:0 3px;padding:2px 8px;border-radius:99px;background:rgba(58,95,138,0.10);color:#3A5F8A;border:1px solid rgba(58,95,138,0.35);font-size:12px;">&#9825;</span>
        <span style="display:inline-block;margin:0 3px;padding:2px 8px;border-radius:99px;background:rgba(138,42,56,0.10);color:#8A2A38;border:1px solid rgba(201,129,140,0.35);font-size:12px;">&#10005;</span>
        ) helps us:
      </p>
      <p style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.ink2};margin:0 0 6px;">
        • <strong style="color:${C.ink};">Send you more matches:</strong> When you rate more we unlock the next match
      </p>
      <p style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.ink2};margin:0;">
        • <strong style="color:${C.ink};">Improve your matches:</strong> Our algorithm learns from your feedback
      </p>
    </div>
  `

  const html = shell(`
    ${eyebrowMarkup}
    ${h1(`New <span style="font-style:italic;">whispers</span> for ${escapeHtml(firstName)}.`)}
    ${p(introCopy, { mt: 12 })}
    ${renderEntries(annotated.newEvents, user.id)}
    ${digestRatingNudgeHtml}
    ${(payload.lockedCount ?? 0) > 0 ? '' : moreHtml}
    ${lockedNudgeHtml}
    ${digestFooterHtml(firstName)}
  `)

  const textLines: string[] = []
  if (!isPerEvent) {
    textLines.push(`Week of ${eb}`, '')
  }
  textLines.push(
    `New whispers for ${firstName}.`,
    '',
    introCopy,
    '',
  )
  const appendEntries = (entries: DigestEventEntry[]) => {
    if (!entries.length) return
    for (const entry of entries) {
      const { event, matchPercent, isDuplicate } = entry
      const date = shortDate(event.date)
      const city = cityFromLocation(event.location)
      const datePart = date ? ` (${date}${city ? ` ${city}` : ''} - ${Math.round(matchPercent)}% Match)` : ` (${Math.round(matchPercent)}% Match)`
      const body = isDuplicate ? ' see above' : event.description ? ` ${event.description}` : ''
      textLines.push(`${event.name}${datePart}${body}`)
      textLines.push(withUtm(event.link))
      textLines.push('')
    }
  }
  appendEntries(annotated.newEvents)
  textLines.push(
    'Rating your matches helps us:',
    '• Send you more matches: When you rate more we unlock the next match',
    '• Improve your matches: Our algorithm learns from your feedback',
    '',
  )
  if (!(payload.lockedCount ?? 0) && moreText) textLines.push(moreText, '')
  if (lockedNudgeText) textLines.push(lockedNudgeText, '')
  textLines.push(...digestFooterTextLines(firstName))
  const text = textLines.join('\n')

  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    bcc: MONITOR_BCC,
    subject: 'New matching Whispered Events',
    html: personalizeDashboardLinks(html, user.email),
    text: personalizeDashboardLinks(text, user.email),
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendUserDigest: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
  const eventIds = annotated.newEvents.map((e) => e.event.id)
  await logDigestSend({
    userId: user.id,
    userEmail: user.email,
    kind,
    eventIds: Array.from(new Set(eventIds)),
  })
}

// Stalemate nudge: sent when a user has locked matches but all top-7
// have already been notified and they've never rated anything.
// Standalone email (no match list). Gated to 28 days via digest_state.
export async function sendStalemateNudge(
  user: AirtableUser,
  lockedCount: number,
): Promise<void> {
  const resend = getResend()
  const firstName = firstNameOrThere(user)
  const safeName = escapeHtml(firstName)
  const noun = lockedCount === 1 ? 'match' : 'matches'

  const html = shell(`
    ${h1(`Hi <span style="font-style:italic;">${safeName}</span> — you have matches waiting.`)}
    ${p(`You have <strong style="color:${C.ink};">${lockedCount} more ${noun} waiting</strong> on Whispered Events.`, { mt: 14 })}
    ${p(`Your feedback on matches helps us constantly improve.`, { mt: 12 })}
    ${p(`To ensure we are only sending you the best events, we send you the top 7 unrated matches. You have more than 7 unrated matches so you can either wait until one of your top matched events happens (when we'll send you another) OR unlock more matches right away by rating events on your dashboard.`, { mt: 8 })}
    ${p(`Just a quick ✓ Interested or ✕ Not a fit on any match opens a new slot.`, { mt: 8 })}
    ${accentButton(DASHBOARD_LINK, 'Rate your matches on the dashboard')}
    ${digestFooterHtml(firstName)}
  `)

  const text = [
    `Hi ${firstName} — you have matches waiting.`,
    '',
    `You have ${lockedCount} more ${noun} waiting on Whispered Events.`,
    '',
    `Your feedback on matches helps us constantly improve.`,
    '',
    `To ensure we are only sending you the best events, we send you the top 7 unrated matches. You have more than 7 unrated matches so you can either wait until one of your top matched events happens (when we'll send you another) OR unlock more matches right away by rating events on your dashboard.`,
    '',
    `Just a quick Interested or Not a fit on any match opens a new slot.`,
    '',
    `Rate your matches on the dashboard: ${DASHBOARD_LINK}`,
    '',
    ...digestFooterTextLines(firstName),
  ].join('\n')

  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    bcc: MONITOR_BCC,
    subject: 'You have matches waiting — here\'s how to unlock them',
    html: personalizeDashboardLinks(html, user.email),
    text: personalizeDashboardLinks(text, user.email),
    headers: AUTO_HEADERS,
  })
  if (error) {
    console.error('sendStalemateNudge: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
  await logDigestSend({
    userId: user.id,
    userEmail: user.email,
    kind: 'coaching',
    eventIds: [],
  })
}
