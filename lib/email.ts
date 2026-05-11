import { Resend } from 'resend'
import { AirtableEvent, AirtableUser } from './airtable'

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY must be set')
  return new Resend(process.env.RESEND_API_KEY)
}

const FROM = 'Whispered Events <events@whisperedevents.com>'
const TEAM_FROM = 'Whispered Events <team@whisperedevents.com>'
const EVENT_FROM = 'Whispered Events <event@whisperedevents.com>'

const ANDY_LINK = 'https://www.linkedin.com/in/amowat/'

function shell(inner: string): string {
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;font-size:15px;line-height:1.55">${inner}</div>`
}

function signature(): string {
  return `<p style="margin:24px 0 0"><a href="${ANDY_LINK}" style="color:#8B6914;text-decoration:underline">Andy</a><br>Founder, Whispered</p>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function sendUserAppliedEmail(email: string): Promise<void> {
  const resend = getResend()
  const html = shell(`
    <p>Hi there —</p>
    <p>Thanks for applying to Whispered Events.</p>
    <p>We'll quickly verify your LinkedIn profile and activate your account (typically within 24 hours).</p>
    <p>Once approved, you'll start seeing event matches curated for senior operators and executives.</p>
    <p>We built Whispered Events for one reason: helping great people find the best events — the ones that aren't posted, they're whispered.</p>
    <p>If you love it, share or tag us on LinkedIn. We ❤️ feedback and feature ideas.</p>
    ${signature()}
    <p style="color:#555;font-size:13px;margin-top:24px">P.S. You can submit events anytime on the site or by emailing event@whisperedevents.com</p>
  `)
  const text = `Hi there —

Thanks for applying to Whispered Events.

We'll quickly verify your LinkedIn profile and activate your account (typically within 24 hours).

Once approved, you'll start seeing event matches curated for senior operators and executives.

We built Whispered Events for one reason: helping great people find the best events — the ones that aren't posted, they're whispered.

If you love it, share or tag us on LinkedIn. We love feedback and feature ideas.

Andy (${ANDY_LINK})
Founder, Whispered

P.S. You can submit events anytime on the site or by emailing event@whisperedevents.com`
  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: email,
    subject: 'Whispered Events - Application Received',
    html,
    text,
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
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Welcome to the club!</p>
    <p>You've been approved for Whispered Events.</p>
    <p>Login via the top right of the site to see your matches (matches typically appear within ~5 minutes of approval).</p>
    <p>You can update your profile anytime to refine your matches — and we ❤️ feedback and feature ideas.</p>
    <p>Whispered Events is 100% free, built to help executives discover great events — the ones that aren't posted, they're whispered.</p>
    <p>Want to help us grow? Share or tag us on LinkedIn.</p>
    ${signature()}
    <p style="color:#555;font-size:13px;margin-top:24px">P.S. You can submit events anytime on the site or via event@whisperedevents.com</p>
  `)
  const text = `Hi ${firstName},

Welcome to the club!

You've been approved for Whispered Events.

Login via the top right of the site to see your matches (matches typically appear within ~5 minutes of approval).

You can update your profile anytime to refine your matches — and we love feedback and feature ideas.

Whispered Events is 100% free, built to help executives discover great events — the ones that aren't posted, they're whispered.

Want to help us grow? Share or tag us on LinkedIn.

Andy (${ANDY_LINK})
Founder, Whispered

P.S. You can submit events anytime on the site or via event@whisperedevents.com`
  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    subject: "You're Approved for Whispered Events",
    html,
    text,
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
    <p>Hi there —</p>
    <p>Thanks for contributing an event to Whispered Events — the platform is powered by contributions like yours.</p>
    <p>"${safeName}" has been added to Whispered Events, and we've updated your contributions.</p>
    <p>Have a great time at your next event, and keep sharing Whispered Events with your network so more great people can discover the right events.</p>
    ${signature()}
    <p style="color:#555;font-size:13px;margin-top:24px">P.S. We ❤️ feedback and feature ideas.</p>
  `)
  const text = `Hi there —

Thanks for contributing an event to Whispered Events — the platform is powered by contributions like yours.

"${eventName}" has been added to Whispered Events, and we've updated your contributions.

Have a great time at your next event, and keep sharing Whispered Events with your network so more great people can discover the right events.

Andy (${ANDY_LINK})
Founder, Whispered

P.S. We love feedback and feature ideas.`
  const { error } = await resend.emails.send({
    from: EVENT_FROM,
    to: email,
    subject: `Event Added - ${eventName}`,
    html,
    text,
  })
  if (error) {
    console.error('sendEventSubmittedEmail: Resend error', { email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
}

export async function sendEventCouldNotReadEmail(email: string): Promise<void> {
  const resend = getResend()
  const html = shell(`
    <p>Hi there —</p>
    <p>Thanks for sending an event to Whispered Events — the platform is powered by contributions like yours.</p>
    <p>We weren't able to extract the event details.</p>
    <p>If you have a public event link (Luma, Eventbrite, the host's site, etc.), send it over and we'll try again.</p>
    ${signature()}
  `)
  const text = `Hi there —

Thanks for sending an event to Whispered Events — the platform is powered by contributions like yours.

We weren't able to extract the event details.

If you have a public event link (Luma, Eventbrite, the host's site, etc.), send it over and we'll try again.

Andy (${ANDY_LINK})
Founder, Whispered`
  const { error } = await resend.emails.send({
    from: EVENT_FROM,
    to: email,
    subject: "We couldn't read your event",
    html,
    text,
  })
  if (error) {
    console.error('sendEventCouldNotReadEmail: Resend error', { email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
}

export async function sendMagicLink(email: string, token: string, baseUrl: string): Promise<void> {
  const resend = getResend()
  const link = `${baseUrl}/api/auth/verify?token=${token}`
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Your Whispered Events login link',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111">
        <p>Click below to log in to Whispered Events. This link expires in 15 minutes.</p>
        <a href="${link}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#8B6914;color:#fff;text-decoration:none;border-radius:8px">Log in to Whispered Events</a>
        <hr style="margin:32px 0;border:none;border-top:1px solid #eee">
        <p style="color:#888;font-size:12px">If you didn't request this, you can safely ignore it.</p>
      </div>
    `,
  })
  if (error) {
    console.error('sendMagicLink: Resend error', { email, from: FROM, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
  console.log('sendMagicLink: sent', { email, id: data?.id })
}

export interface DigestEventEntry {
  event: AirtableEvent
  matchPercent: number
}

export interface DigestPayload {
  newEvents: DigestEventEntry[]
  topMatches: DigestEventEntry[]
}

const DASHBOARD_LINK = 'https://www.whisperedevents.com/dashboard'
const TAG_US_LINK = 'https://www.linkedin.com/company/whispered-events'
const NEW_EVENT_MAILTO = 'mailto:event@whisperedevents.com'

export function firstNameOrThere(user: AirtableUser): string {
  const f = user.firstName?.trim()
  if (f && f.toUpperCase() !== 'DEFAULT') return f
  // Fall back to first token of Name if FirstName isn't populated yet.
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
  const { event, matchPercent } = entry
  const date = shortDate(event.date)
  const datePart = date ? `<strong> (${date})</strong> ` : ' '
  const desc = event.description ? `${escapeHtml(event.description)} ` : ''
  const match = `<strong>(Match ${Math.round(matchPercent)}%)</strong>`
  return `
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55">
      <a href="${event.link}" style="color:#1a73e8;font-weight:bold;text-decoration:underline">${escapeHtml(event.name)}</a>${datePart}${desc}${match}
    </p>
  `
}

function renderSection(title: string, entries: DigestEventEntry[]): string {
  if (!entries.length) return ''
  return `
    <h2 style="margin:24px 0 12px;font-size:18px;color:#111">${title}</h2>
    ${entries.map(renderEntry).join('')}
  `
}

export async function sendUserDigest(
  user: AirtableUser,
  payload: DigestPayload,
): Promise<void> {
  if (!payload.newEvents.length) return
  const resend = getResend()

  const firstName = firstNameOrThere(user)

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;font-size:15px;line-height:1.55">
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>We have some new matching Whispered Events for you</p>
      ${renderSection('New', payload.newEvents)}
      ${renderSection('Top Matches', payload.topMatches)}
      <hr style="margin:32px 0;border:none;border-top:1px solid #eee">
      <div style="text-align:center;color:#555;font-size:13px;font-style:italic;line-height:1.7">
        <div>Update your match criteria and frequency on <a href="${DASHBOARD_LINK}" style="color:#1a73e8;text-decoration:underline">your Dashboard</a>.</div>
        <div>Email new events to <a href="${NEW_EVENT_MAILTO}" style="color:#1a73e8;text-decoration:underline">event@whisperedevents.com</a></div>
        <div>And … help more execs discover great events by <a href="${TAG_US_LINK}" style="color:#1a73e8;text-decoration:underline">tagging us</a> on LinkedIn</div>
      </div>
    </div>
  `

  const textLines: string[] = [
    `Hi ${firstName},`,
    '',
    'We have some new matching Whispered Events for you',
    '',
  ]
  const appendSection = (title: string, entries: DigestEventEntry[]) => {
    if (!entries.length) return
    textLines.push(title, '')
    for (const { event, matchPercent } of entries) {
      const date = shortDate(event.date)
      const datePart = date ? ` (${date})` : ''
      const desc = event.description ? ` ${event.description}` : ''
      textLines.push(`${event.name}${datePart}${desc} (Match ${Math.round(matchPercent)}%)`)
      textLines.push(event.link)
      textLines.push('')
    }
  }
  appendSection('New', payload.newEvents)
  appendSection('Top Matches', payload.topMatches)
  textLines.push(`Update your match criteria and frequency on your Dashboard: ${DASHBOARD_LINK}`)
  textLines.push(`Email new events to event@whisperedevents.com`)
  textLines.push(`And help more execs discover great events by tagging us on LinkedIn: ${TAG_US_LINK}`)
  const text = textLines.join('\n')

  const { error } = await resend.emails.send({
    from: TEAM_FROM,
    to: user.email,
    subject: 'New Matching Whispered Events',
    html,
    text,
  })
  if (error) {
    console.error('sendUserDigest: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
}
