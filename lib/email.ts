import { Resend } from 'resend'
import { AirtableEvent, AirtableUser } from './airtable'

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY must be set')
  return new Resend(process.env.RESEND_API_KEY)
}

const FROM = 'Whispered Events <events@whispered.events>'

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
  await resend.emails.send({
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
