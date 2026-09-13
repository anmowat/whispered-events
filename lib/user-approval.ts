// Approval flow that runs when a user transitions from Pending into Live.
// Previously fanned out from the Airtable "User Approved" automation
// (/api/airtable-user-approved); now triggered server-side from the admin
// PATCH because Users are Supabase-canonical and Airtable no longer fires.
//
// One mode for everyone: fire process-matches?welcome=1 so the matching
// pipeline runs and sendApprovedWithDigest ships the combined welcome
// email — matches if any, coaching variant A (no events in area) or B
// (events nearby but no match) if none.
//
// Paused users used to get a separate plain-text approval email; that meant
// users in dead zones (e.g. signups from cities with no events nearby) got
// no acknowledgement of their situation. Now they share the same welcome
// shape as non-paused: matches if any are above threshold, or the coaching
// block pointing them at the dashboard. Process-matches gates the ONGOING
// match-delivery emails on frequency separately, so Paused users still
// don't get the cadence digests.
//
// linkContributionsToUser runs unconditionally as belt-and-suspenders for
// users whose row was created administratively (no createProfile call to
// trigger the link).

import { linkContributionsToUser } from './supabase'
import type { AirtableUser } from './airtable'
import { internalSecretHeaders } from './internal-auth'
import { listShareContacts, markShareContactInvited } from './supabase'
import { getUserByEmail } from './users'
import { sendShareInviteEmail } from './email'

export async function triggerUserApprovedFlow(
  user: AirtableUser,
  opts: { appUrl?: string } = {},
): Promise<void> {
  if (!user.email || !user.id) return
  const appUrl =
    opts.appUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  try {
    await linkContributionsToUser(user.id, user.email)
  } catch (e) {
    console.error('triggerUserApprovedFlow: linkContributionsToUser failed', e)
  }

  try {
    await sendPendingShareInvites(user)
  } catch (e) {
    console.error('triggerUserApprovedFlow: sendPendingShareInvites failed', e)
  }

  try {
    await fetch(
      `${appUrl}/api/process-matches?trigger=user&id=${user.id}&welcome=1`,
      { headers: internalSecretHeaders() },
    )
  } catch (e) {
    console.error('triggerUserApprovedFlow: welcome trigger failed', e)
  }
}

/**
 * Invite the contacts this member added during signup.
 *
 * Nothing is mailed at signup time: a Pending applicant could otherwise make
 * our domain email strangers before being vetted. The rows sit with
 * invited_at null until approval, which is this.
 *
 * Only non-members are mailed - an existing member hears about a new sharer in
 * their next digest instead. invited_at is stamped on send, so re-running this
 * (a second approval, an admin re-save) never mails anyone twice.
 */
async function sendPendingShareInvites(user: AirtableUser): Promise<void> {
  const contacts = await listShareContacts(user.id)
  const pending = contacts.filter((c) => !c.invitedAt)
  if (pending.length === 0) return

  for (const contact of pending) {
    try {
      const existing = await getUserByEmail(contact.contactEmail)
      if (existing) continue
      await sendShareInviteEmail({
        contactEmail: contact.contactEmail,
        sharerName: user.name ?? '',
        sharerFirstName: user.firstName ?? '',
      })
      await markShareContactInvited(contact.id)
    } catch (e) {
      // One bad address must not stop the rest.
      console.error('sendPendingShareInvites: invite failed', {
        userId: user.id,
        contact: contact.contactEmail,
        e,
      })
    }
  }
}
