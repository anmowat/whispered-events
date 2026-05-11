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

export async function sendUserApprovedEmail(email: string): Promise<void> {
  const resend = getResend()
  const html = shell(`
    <p>Welcome to the club!</p>
    <p>You've been approved for Whispered Events.</p>
    <p>Login via the top right of the site to see your matches (matches typically appear within ~5 minutes of approval).</p>
    <p>You can update your profile anytime to refine your matches — and we ❤️ feedback and feature ideas.</p>
    <p>Whispered Events is 100% free, built to help executives discover great events — the ones that aren't posted, they're whispered.</p>
    <p>Want to help us grow? Share or tag us on LinkedIn.</p>
    ${signature()}
    <p style="color:#555;font-size:13px;margin-top:24px">P.S. You can submit events anytime on the site or via event@whisperedevents.com</p>
  `)
  const text = `Welcome to the club!

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
    to: email,
    subject: "You're Approved for Whispered Events",
    html,
    text,
  })
  if (error) {
    console.error('sendUserApprovedEmail: Resend error', { email, error })
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

export interface DigestPayload {
  newEvents: AirtableEvent[]
  topMatches: AirtableEvent[]
  totalCandidateCount: number
}

function renderEventCard(e: AirtableEvent): string {
  const dateFormatted = e.date
    ? new Date(e.date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : ''
  const meta = [e.type, dateFormatted, e.location].filter(Boolean).join(' · ')
  return `
    <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #eee">
      <h3 style="margin:0 0 4px;font-size:17px"><a href="${e.link}" style="color:#000;text-decoration:none">${escapeHtml(e.name)}</a></h3>
      <p style="color:#555;margin:0 0 8px;font-size:14px">${escapeHtml(meta)}</p>
      ${e.description ? `<p style="margin:0;font-size:14px">${escapeHtml(e.description)}</p>` : ''}
    </div>
  `
}

function renderSection(title: string, events: AirtableEvent[]): string {
  if (!events.length) return ''
  return `
    <h2 style="margin:24px 0 12px;font-size:18px;color:#111">${title}</h2>
    ${events.map(renderEventCard).join('')}
  `
}

export async function sendUserDigest(
  user: AirtableUser,
  payload: DigestPayload,
): Promise<void> {
  if (!payload.newEvents.length) return
  const resend = getResend()

  const firstName =
    user.name && user.name !== 'DEFAULT' ? ` ${user.name.split(' ')[0]}` : ''
  const newCount = payload.newEvents.length
  const subject = `${newCount} new event${newCount > 1 ? 's' : ''} for you`

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.whisperedevents.com'
  const dashboardLink = `${appUrl}/dashboard`

  const moreCta =
    payload.totalCandidateCount > payload.newEvents.length + payload.topMatches.length
      ? `<p style="margin:16px 0 0"><a href="${dashboardLink}" style="color:#8B6914;text-decoration:underline">View more matches on your dashboard →</a></p>`
      : ''

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111;font-size:15px;line-height:1.55">
      <p>Hi${firstName},</p>
      ${renderSection('New for you', payload.newEvents)}
      ${renderSection('Top matches', payload.topMatches)}
      ${moreCta}
      <hr style="margin:32px 0;border:none;border-top:1px solid #eee">
      <p style="color:#888;font-size:12px">You're receiving this because you're a member of Whispered. Update your email frequency on <a href="${dashboardLink}" style="color:#888">your dashboard</a>.</p>
    </div>
  `

  const textLines: string[] = [`Hi${firstName},`, '']
  const appendSection = (title: string, events: AirtableEvent[]) => {
    if (!events.length) return
    textLines.push(title, '')
    for (const e of events) {
      const dateFormatted = e.date
        ? new Date(e.date).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })
        : ''
      const meta = [e.type, dateFormatted, e.location].filter(Boolean).join(' · ')
      textLines.push(e.name)
      if (meta) textLines.push(meta)
      textLines.push(e.link)
      textLines.push('')
    }
  }
  appendSection('New for you:', payload.newEvents)
  appendSection('Top matches:', payload.topMatches)
  if (
    payload.totalCandidateCount >
    payload.newEvents.length + payload.topMatches.length
  ) {
    textLines.push(`View more matches on your dashboard: ${dashboardLink}`)
  }
  const text = textLines.join('\n')

  const { error } = await resend.emails.send({
    from: FROM,
    to: user.email,
    subject,
    html,
    text,
  })
  if (error) {
    console.error('sendUserDigest: Resend error', { email: user.email, error })
    throw new Error(`Resend send failed: ${error.message ?? JSON.stringify(error)}`)
  }
}
