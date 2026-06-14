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
  <strong style="color:${C.ink2};">Use <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">your dashboard</a> to</strong> view matches, update your profile, and control match frequency<br>
  <strong style="color:${C.ink2};">Know an event we should add?</strong> Email <a href="${NEW_EVENT_MAILTO}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">event@whispered.com</a>
</p>
`.trim()
}

function digestFooterTextLines(_firstName: string): string[] {
  return [
    `Use your dashboard to view matches, update your profile, and control match frequency — ${DASHBOARD_LINK}`,
    `Know an event we should add? Email event@whispered.com`,
  ]
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
    ${p("Thanks for applying to Whispered Events. We'll quickly verify your LinkedIn profile and activate your account — typically within 24 hours.", { mt: 14 })}
    ${p("Once approved, you'll start seeing event matches curated for senior operators and executives.", { mt: 12 })}
    ${p("We built Whispered Events for one reason: helping great people find the best events — the ones that aren't posted, they're whispered.", { mt: 12 })}
    ${p(`If you love it, amplify <a href="${AMPLIFY_POST_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">this post</a> on LinkedIn with a comment / repost. We &#10084; feedback and feature ideas.`, { mt: 14 })}
    ${signature()}
    ${ps('P.S. You can submit events anytime on the site or by emailing event@whispered.com')}
  `)
  const text = `Application received.

Thanks for applying to Whispered Events. We'll quickly verify your LinkedIn profile and activate your account — typically within 24 hours.

Once approved, you'll start seeing event matches curated for senior operators and executives.

We built Whispered Events for one reason: helping great people find the best events — the ones that aren't posted, they're whispered.

If you love it, amplify this post on LinkedIn with a comment/repost (${AMPLIFY_POST_LINK}). We love feedback and feature ideas.

Andy (${ANDY_LINK})
Founder, Whispered

P.S. You can submit events anytime on the site or by emailing event@whispered.com`
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
  const eb = todayEyebrow()
  const html = shell(`
    ${eyebrow(`Welcome · ${eb}`)}
    ${h1(`<span style="font-style:italic;">Welcome</span> to the club, ${escapeHtml(firstName)}.`)}
    ${p("You've been approved for Whispered Events. Login via the top right of the site to see your matches — matches typically appear within ~5 minutes of approval.", { mt: 14 })}
    ${p("You can update your profile anytime to refine your matches — and we &#10084; feedback and feature ideas.", { mt: 12 })}
    ${p("Whispered Events is 100% free, built to help executives discover great events — the ones that aren't posted, they're whispered.", { mt: 12 })}
    ${digestFooterHtml(firstName)}
  `)
  const text = [
    `Welcome · ${eb}`,
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
  const firstName = firstNameFromEmail(email)
  const html = shell(`
    ${h1(`Event <span style="font-style:italic;">added</span>.`)}
    ${p('Thanks for contributing an event to Whispered Events — the platform is powered by contributions like yours.', { mt: 14 })}
    ${p(`<strong style="color:${C.ink};">"${safeName}"</strong> has been added, and we've updated your contributions.`, { mt: 12 })}
    ${p('Have a great time at your next event, and keep sharing Whispered Events with your network so more great people can discover the right events.', { mt: 12 })}
    ${digestFooterHtml(firstName)}
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
    ...digestFooterTextLines(firstName),
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

  const html = shell(`
    <div style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};">
      ${substituted}
    </div>
    ${digestFooterHtml(firstName)}
  `)
  const text = [htmlToText(substituted), '', ...digestFooterTextLines(firstName)].join('\n')

  // Blasts deliberately skip the MONITOR_BCC. Sends fan out to dozens
  // of users at a time and Andy's inbox doesn't need a duplicate of
  // each. Resend's dashboard is the audit trail.
  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    subject,
    html,
    text,
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
// 100 miles of their location:
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
    html,
    text,
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
    ${eyebrow(`A nudge · ${eb}`)}
    ${h1(`Hi <span style="font-style:italic;">${safeName}</span>.`)}
    ${p(
      `We don't have any upcoming Whispered Events within 100 miles of ${locationPhrase} yet. Two quick ways to change that:`,
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
    `A nudge · ${eb}`,
    '',
    `Hi ${safeName}.`,
    '',
    `We don't have any upcoming Whispered Events within 100 miles of ${locationPhrase} yet. Two quick ways to change that:`,
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
    ${eyebrow(`A nudge · ${eb}`)}
    ${h1(`Hi <span style="font-style:italic;">${safeName}</span>.`)}
    ${p(
      `We have ${nearbyCount} upcoming ${noun} within 100 miles of ${locationPhrase}, but none are matching your profile yet. Two ways to fix that:`,
      { mt: 14 },
    )}
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:14px 0 0;">
      <strong style="color:${C.ink};">1. Update your topics</strong> on your <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">dashboard</a> — add subjects you want events about (e.g. "RevOps", "GTM", "AI agents", specific industries).
    </p>
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:10px 0 0;">
      <strong style="color:${C.ink};">2. Share events in topics you care about</strong> — email any link to <a href="${NEW_EVENT_MAILTO}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">event@whispered.com</a> to help build momentum.
    </p>
    ${digestFooterHtml(firstName)}
  `)
  const text = [
    `A nudge · ${eb}`,
    '',
    `Hi ${safeName}.`,
    '',
    `We have ${nearbyCount} upcoming ${noun} within 100 miles of ${locationPhrase}, but none are matching your profile yet. Two ways to fix that:`,
    '',
    `1. Update your topics on your dashboard — add subjects you want events about (e.g. "RevOps", "GTM", "AI agents", specific industries).`,
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
    ${eyebrow(`Quick recap · ${eb}`)}
    ${h1(`Hi <span style="font-style:italic;">${safeName}</span>.`)}
    ${p(
      `Quick recap — we have ${nearbyCount} upcoming ${nearbyNoun} within 100 miles of ${locationPhrase}, and your profile ${matchVerb} ${totalMatchCount} of them. Here are your top ${matchNoun}:`,
      { mt: 14 },
    )}
    ${renderEntries(annotated.topMatches)}
    ${p(
      `Want to see more? Update your interests on your <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">dashboard</a> — add functions or topics you'd like to see (e.g. "RevOps", "GTM", "AI", specific industries).`,
      { mt: 14 },
    )}
    ${digestFooterHtml(firstName)}
  `)

  const textLines: string[] = [
    `Quick recap · ${eb}`,
    '',
    `Hi ${firstName}.`,
    '',
    `Quick recap — we have ${nearbyCount} upcoming ${nearbyNoun} within 100 miles of ${user.location || 'your area'}, and your profile ${matchVerb} ${totalMatchCount} of them. Here are your top ${matchNoun}:`,
    '',
  ]
  for (const entry of annotated.topMatches) {
    const { event, matchPercent, isDuplicate } = entry
    const date = shortDate(event.date)
    const datePart = date ? ` (${date})` : ''
    const body = isDuplicate ? ' see above' : event.description ? ` ${event.description}` : ''
    textLines.push(`${event.name}${datePart}${body} (Match ${Math.round(matchPercent)}%)`)
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
    html,
    text: textLines.join('\n'),
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

export async function sendEventCouldNotReadEmail(email: string): Promise<void> {
  const resend = getResend()
  const firstName = firstNameFromEmail(email)
  const html = shell(`
    ${h1(`We couldn't <span style="font-style:italic;">read</span> your event.`)}
    ${p('Thanks for sending an event to Whispered Events — the platform is powered by contributions like yours.', { mt: 14 })}
    ${p("We weren't able to extract the event details.", { mt: 12 })}
    ${p("If you have a public event link (Luma, Eventbrite, the host's site, etc.), send it over and we'll try again.", { mt: 12 })}
    ${digestFooterHtml(firstName)}
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
    ...digestFooterTextLines(firstName),
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
  // Dates: bold but neutral (ink-2) — readers used to ignore them
  // when they were oxblood because the link itself wasn't tinted.
  const datePart = date
    ? `<strong style="color:${C.ink2};font-variant-numeric:tabular-nums;"> (${date})</strong> `
    : ' '
  const match = `<strong style="color:${C.ink};">(Match ${Math.round(matchPercent)}%)</strong>`
  const body = isDuplicate
    ? `<em style="color:${C.ink3};">see above</em> `
    : event.description
      ? `<span style="color:${C.ink2};">${escapeHtml(event.description)}</span> `
      : ''
  // Event title: oxblood + underlined so the click affordance is
  // obvious. text-underline-offset matches the rest of the email's
  // link treatment.
  return `
<p style="font-family:${SANS};margin:0 0 14px;font-size:14.5px;line-height:1.55;">
  <a href="${event.link}" style="font-family:${SERIF};font-size:17px;color:${C.accent};text-decoration:underline;text-underline-offset:3px;font-weight:400;letter-spacing:-0.01em;">${escapeHtml(event.name)}</a>${datePart}${body}${match}
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

function renderEntries(entries: DigestEventEntry[]): string {
  if (!entries.length) return ''
  return `<div style="margin-top:22px;">${entries.map(renderEntry).join('')}</div>`
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

  const introCopy = hasMatches
    ? "You've been approved for Whispered Events. Here are some upcoming events that match your profile:"
    : includeCoaching
      ? "You've been approved for Whispered Events. We don't have matching events for you yet — here are two quick ways to fix that:"
      : "You've been approved for Whispered Events."

  const eb = todayEyebrow()
  const html = shell(`
    ${eyebrow(`Welcome · ${eb}`)}
    ${h1(`<span style="font-style:italic;">Welcome</span> to the club, ${escapeHtml(firstName)}.`)}
    ${p(introCopy, { mt: 14 })}
    ${renderEntries(annotated.newEvents)}
    ${coachingHtml}
    ${digestFooterHtml(firstName)}
  `)

  const textLines: string[] = [
    `Welcome · ${eb}`,
    '',
    `Welcome to the club, ${firstName}.`,
    '',
    introCopy,
    '',
  ]
  const appendEntries = (entries: DigestEventEntry[]) => {
    if (!entries.length) return
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
  appendEntries(annotated.newEvents)
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
    html,
    text,
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

// Inline coaching block reused inside the welcome email. Mirrors the
// standalone sendCoaching templates so a new user with no matches sees
// the same guidance the Monday cron would send them later.
function renderInlineCoaching(safeLocation: string, nearbyCount: number): string {
  if (nearbyCount === 0) {
    const locationPhrase = safeLocation || 'your area'
    return `
<p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:14px 0 0;">
  <strong style="color:${C.ink};">1. Help us build a presence in ${locationPhrase}</strong> — share events you see, email any link to <a href="${NEW_EVENT_MAILTO}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">event@whispered.com</a> and we'll add it in!
</p>
<p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:10px 0 0;">
  <strong style="color:${C.ink};">2. Update your location</strong> on your <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">dashboard</a> if you've moved or are traveling — your matches will re-run automatically.
</p>
`.trim()
  }
  const locationPhrase = safeLocation || 'you'
  const noun = nearbyCount === 1 ? 'event' : 'events'
  return `
<p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:14px 0 0;">We do have ${nearbyCount} upcoming ${noun} within 100 miles of ${locationPhrase} — your profile just isn't matching them yet.</p>
<p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:10px 0 0;">
  <strong style="color:${C.ink};">1. Update your topics</strong> on your <a href="${DASHBOARD_LINK}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">dashboard</a> — add subjects you want events about (e.g. "RevOps", "GTM", "AI agents", specific industries).
</p>
<p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${C.ink2};margin:10px 0 0;">
  <strong style="color:${C.ink};">2. Share events in topics you care about</strong> — email any link to <a href="${NEW_EVENT_MAILTO}" style="color:${C.accent};text-decoration:underline;text-underline-offset:3px;">event@whispered.com</a> to help build momentum.
</p>
`.trim()
}

function inlineCoachingTextLines(location: string, nearbyCount: number): string[] {
  if (nearbyCount === 0) {
    const locationPhrase = location || 'your area'
    return [
      `1. Help us build a presence in ${locationPhrase} — share events you see, email any link to event@whispered.com and we'll add it in!`,
      `2. Update your location on your dashboard if you've moved or are traveling — your matches will re-run automatically.`,
    ]
  }
  const locationPhrase = location || 'you'
  const noun = nearbyCount === 1 ? 'event' : 'events'
  return [
    `We do have ${nearbyCount} upcoming ${noun} within 100 miles of ${locationPhrase} — your profile just isn't matching them yet.`,
    '',
    `1. Update your topics on your dashboard — add subjects you want events about (e.g. "RevOps", "GTM", "AI agents", specific industries).`,
    `2. Share events in topics you care about — email any link to event@whispered.com to help build momentum.`,
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
  const eyebrowMarkup = isPerEvent ? '' : eyebrow(`Week of ${eb}`)
  const introCopy = isPerEvent
    ? 'We have a new matching event for you.'
    : 'We have some new matching Whispered Events for you.'

  const html = shell(`
    ${eyebrowMarkup}
    ${h1(`New <span style="font-style:italic;">whispers</span> for ${escapeHtml(firstName)}.`)}
    ${p(introCopy, { mt: 12 })}
    ${renderEntries(annotated.newEvents)}
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
      const datePart = date ? ` (${date})` : ''
      const body = isDuplicate ? ' see above' : event.description ? ` ${event.description}` : ''
      textLines.push(`${event.name}${datePart}${body} (Match ${Math.round(matchPercent)}%)`)
      textLines.push(event.link)
      textLines.push('')
    }
  }
  appendEntries(annotated.newEvents)
  textLines.push(...digestFooterTextLines(firstName))
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
  const eventIds = annotated.newEvents.map((e) => e.event.id)
  await logDigestSend({
    userId: user.id,
    userEmail: user.email,
    kind,
    eventIds: Array.from(new Set(eventIds)),
  })
}
