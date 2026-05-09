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

export async function sendEventNotification(
  user: AirtableUser,
  event: AirtableEvent
): Promise<void> {
  const resend = getResend()
  const dateFormatted = event.date
    ? new Date(event.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  await resend.emails.send({
    from: FROM,
    to: user.email,
    subject: `New event for you: ${event.name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111">
        <p>Hi${user.name && user.name !== 'DEFAULT' ? ` ${user.name.split(' ')[0]}` : ''},</p>
        <p>A new event was just added that looks like a great fit for you:</p>
        <h2 style="margin:16px 0 4px">${event.name}</h2>
        <p style="color:#555;margin:0">${event.type}${dateFormatted ? ` · ${dateFormatted}` : ''}${event.location ? ` · ${event.location}` : ''}</p>
        ${event.description ? `<p style="margin-top:12px">${event.description}</p>` : ''}
        <a href="${event.link}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#000;color:#fff;text-decoration:none;border-radius:4px">View event</a>
        <hr style="margin:32px 0;border:none;border-top:1px solid #eee">
        <p style="color:#888;font-size:12px">You're receiving this because you're a member of Whispered. Reply to unsubscribe.</p>
      </div>
    `,
  })
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

export async function sendUserDigest(
  user: AirtableUser,
  events: AirtableEvent[]
): Promise<void> {
  if (!events.length) return
  const resend = getResend()

  const eventItems = events
    .slice(0, 5)
    .map((e) => {
      const dateFormatted = e.date
        ? new Date(e.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : ''
      return `
        <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #eee">
          <h3 style="margin:0 0 4px"><a href="${e.link}" style="color:#000">${e.name}</a></h3>
          <p style="color:#555;margin:0 0 8px;font-size:14px">${e.type}${dateFormatted ? ` · ${dateFormatted}` : ''}${e.location ? ` · ${e.location}` : ''}</p>
          ${e.description ? `<p style="margin:0;font-size:14px">${e.description}</p>` : ''}
        </div>
      `
    })
    .join('')

  await resend.emails.send({
    from: FROM,
    to: user.email,
    subject: `${events.length} event${events.length > 1 ? 's' : ''} matched to your profile`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111">
        <p>Hi${user.name && user.name !== 'DEFAULT' ? ` ${user.name.split(' ')[0]}` : ''},</p>
        <p>Welcome to Whispered! Here are the upcoming events that match your profile:</p>
        ${eventItems}
        <hr style="margin:32px 0;border:none;border-top:1px solid #eee">
        <p style="color:#888;font-size:12px">You're receiving this because you just joined Whispered. Reply to unsubscribe.</p>
      </div>
    `,
  })
}
