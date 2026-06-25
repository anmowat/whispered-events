// Internal Slack notifications. Single Incoming Webhook URL, single channel,
// no Block Kit (mrkdwn is grep-friendlier and these messages are
// short-lived). All four notifiers no-op silently when SLACK_WEBHOOK_URL
// is unset, so local dev doesn't need to configure Slack.

import { UserProfile, EventRecord } from './types'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.whisperedevents.com'

// Raw POST to the webhook. Logs + swallows errors so callers never bubble
// a Slack outage into the user-facing response. Exported for ad-hoc use; the
// four notifyXxx formatters below cover the standard paths.
export async function postSlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('postSlack non-2xx', { status: res.status, body: body.slice(0, 200) })
    }
  } catch (err) {
    console.error('postSlack failed', err)
  }
}

// Identifier line used at the top of every notification. Renders the
// person as a clickable LinkedIn hyperlink when we have the URL, with
// email as a secondary identifier. Falls back cleanly when LinkedIn
// (and even name) are missing so pre-signup callers don't generate
// broken `<|>` syntax.
//
// Slack mrkdwn link syntax: `<URL|label>` → label is clickable.
function formatPerson(p: {
  name?: string | null
  email: string
  linkedin?: string | null
}): string {
  // 'DEFAULT' is the project's sentinel for "no real name on file" — the
  // admin dashboard already skips it, so honour the same convention here.
  const rawName = (p.name || '').trim()
  const display = rawName && rawName !== 'DEFAULT' ? rawName : p.email
  const linkedin = (p.linkedin || '').trim()
  if (linkedin) {
    // When the display is the email (no name), there's nothing to gain
    // from `<url|email> · email` — collapse to a single linked email.
    if (display === p.email) return `<${linkedin}|${p.email}>`
    return `<${linkedin}|${display}> · ${p.email}`
  }
  if (display === p.email) return p.email
  return `*${display}* · ${p.email}`
}

// New user signup. Mirrors the existing Airtable automation format —
// LinkedIn (via the lead line's hyperlink), Employment+Size, Interest,
// email, "Find" (how they heard about us, sourced from UserProfile.learn).
// Deep links to the admin user detail page so admin can triage in one click.
export async function notifyNewUser(
  profile: UserProfile,
  userId: string,
  name?: string,
): Promise<void> {
  const lines: string[] = [
    `*New user* ${formatPerson({ name, email: profile.email, linkedin: profile.linkedin })}`,
  ]
  const employmentLine = [profile.employment, profile.companySize].filter(Boolean).join('-')
  if (employmentLine) lines.push(`*Employment* (${employmentLine})`)
  if (profile.interest) lines.push(`*Interest* (${profile.interest})`)
  if (profile.learn) lines.push(`*Find* (${profile.learn})`)
  lines.push(`${APP_URL}/admin/users/${userId}`)
  await postSlack(lines.join('\n'))
}

// New event submission. Event name + source URL + submitter (name +
// LinkedIn hyperlink when the submitter is a known user, else email).
export async function notifyNewEvent(
  event: EventRecord,
  eventId: string,
  submitter?: { name?: string | null; linkedin?: string | null } | null,
): Promise<void> {
  const lines: string[] = [`*New event* ${event.name}`]
  if (event.link) lines.push(event.link)
  if (event.submitter) {
    lines.push(
      `Submitted by ${formatPerson({
        name: submitter?.name,
        email: event.submitter,
        linkedin: submitter?.linkedin,
      })}`,
    )
  }
  lines.push(`${APP_URL}/admin/events/${eventId}`)
  await postSlack(lines.join('\n'))
}

// Field-name display labels for profile + event change messages. Keeps the
// Slack message readable (e.g. "Company Size" instead of "companySize").
const PROFILE_FIELD_LABELS: Record<string, string> = {
  location: 'Location',
  interest: 'Interest',
  employment: 'Employment',
  companySize: 'Company Size',
  frequency: 'Frequency',
  function: 'Function',
}

const EVENT_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  type: 'Type',
  date: 'Date',
  location: 'Location',
  description: 'Description',
  audience: 'Audience',
}

// Before/after pair for a single field change. Routes build the diff
// against the pre-edit row (already in memory for auth / digest paths) and
// hand it here so the Slack message shows "old → new" instead of just the
// new value.
export type FieldChange = { from: string; to: string }

function renderValue(v: string, side: 'from' | 'to'): string {
  if (v === '') return side === 'from' ? '(empty)' : '(cleared)'
  return v
}

// User self-service profile edit at /dashboard/profile. The `changes`
// argument should contain only the fields that actually changed (not the
// entire profile), so most messages render as 1-2 lines.
export async function notifyUserProfileUpdate(params: {
  email: string
  userId?: string
  name?: string | null
  linkedin?: string | null
  changes: Record<string, FieldChange>
}): Promise<void> {
  const { email, userId, name, linkedin, changes } = params
  const entries = Object.entries(changes)
  if (entries.length === 0) return
  const lines: string[] = [`*Profile update* ${formatPerson({ name, email, linkedin })}`]
  for (const [k, v] of entries) {
    const label = PROFILE_FIELD_LABELS[k] || k
    lines.push(`${label}: ${renderValue(v.from, 'from')} → ${renderValue(v.to, 'to')}`)
  }
  if (userId) lines.push(`${APP_URL}/admin/users/${userId}`)
  await postSlack(lines.join('\n'))
}

// Host self-service event edit at /host/events/[id]. NOT fired by admin
// edits at /admin/events/[id] — admin saves are silent by design.
export async function notifyHostEventUpdate(params: {
  eventId: string
  eventName: string
  eventLink?: string
  hostEmail: string
  hostName?: string | null
  hostLinkedin?: string | null
  changes: Record<string, FieldChange>
}): Promise<void> {
  const { eventId, eventName, eventLink, hostEmail, hostName, hostLinkedin, changes } = params
  const entries = Object.entries(changes)
  if (entries.length === 0) return
  const lines: string[] = [
    `*Host updated event* ${eventName}`,
    `by ${formatPerson({ name: hostName, email: hostEmail, linkedin: hostLinkedin })}`,
  ]
  if (eventLink) lines.push(eventLink)
  for (const [k, v] of entries) {
    const label = EVENT_FIELD_LABELS[k] || k
    lines.push(`${label}: ${renderValue(v.from, 'from')} → ${renderValue(v.to, 'to')}`)
  }
  lines.push(`${APP_URL}/admin/events/${eventId}`)
  await postSlack(lines.join('\n'))
}
