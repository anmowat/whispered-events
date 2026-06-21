// Approval flow that runs when a user transitions from Pending into Live.
// Previously fanned out from the Airtable "User Approved" automation
// (/api/airtable-user-approved); now triggered server-side from the admin
// PATCH because Users are Supabase-canonical and Airtable no longer fires.
//
// Two-mode behavior preserved from the original webhook:
//   - Paused users: send the plain approval email immediately, then run
//     matching in the background with ?noEmail=1 so the dashboard has
//     data on first login but doesn't get an extra digest email.
//   - Digest-receiving users: defer the approval email and let
//     process-matches ship one combined "welcome + first matches" via
//     sendApprovedWithDigest.
//
// linkContributionsToUser runs unconditionally as belt-and-suspenders for
// users whose row was created administratively (no createProfile call to
// trigger the link).

import { sendUserApprovedEmail } from './email'
import { linkContributionsToUser } from './supabase'
import type { AirtableUser } from './airtable'

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

  const isPaused = user.frequency === 'Paused'

  if (isPaused) {
    try {
      await sendUserApprovedEmail(user)
    } catch (e) {
      console.error('triggerUserApprovedFlow: sendUserApprovedEmail failed', e)
    }
    try {
      await fetch(
        `${appUrl}/api/process-matches?trigger=user&id=${user.id}&noEmail=1`,
      )
    } catch (e) {
      console.error('triggerUserApprovedFlow: noEmail trigger failed', e)
    }
    return
  }

  try {
    await fetch(
      `${appUrl}/api/process-matches?trigger=user&id=${user.id}&welcome=1`,
    )
  } catch (e) {
    console.error('triggerUserApprovedFlow: welcome trigger failed', e)
  }
}
