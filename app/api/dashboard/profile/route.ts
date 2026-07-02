import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { verifySession, markAllMatchesNotifiedForUser } from '@/lib/supabase'
import { updateUserProfile, UserProfileUpdate } from '@/lib/airtable'
import { getUserByEmail } from '@/lib/users'
import { notifyUserProfileUpdate, type FieldChange } from '@/lib/slack'

// Frequencies that result in an email digest. 'Paused' opts out.
const DIGEST_FREQUENCIES = new Set(['As they arrive', 'Weekly', 'Monthly'])

export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value
  if (!sessionToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const session = await verifySession(sessionToken)
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const email = session.email

  const body = (await req.json()) as UserProfileUpdate
  const update: UserProfileUpdate = {}
  if (typeof body.location === 'string') update.location = body.location
  if (typeof body.interest === 'string') update.interest = body.interest
  if (typeof body.employment === 'string') update.employment = body.employment
  if (typeof body.companySize === 'string') update.companySize = body.companySize
  if (typeof body.frequency === 'string') update.frequency = body.frequency
  if (typeof body.function === 'string') update.function = body.function

  // Mirror the application form rule — Size only meaningful when Employed
  if (update.employment && update.employment.toLowerCase() !== 'employed') {
    update.companySize = ''
  }

  // Frequency is a delivery preference, not a matching input — skip the
  // re-match if it's the only thing that changed.
  const matchingInputsChanged =
    update.location !== undefined ||
    update.interest !== undefined ||
    update.employment !== undefined ||
    update.companySize !== undefined ||
    update.function !== undefined

  try {
    // Capture the user's pre-update state. Used by three downstream paths:
    //   (a) Dashboard-Only → digest frequency transitions (zero out backlog)
    //   (b) A location change (trigger the location-update digest email)
    //   (c) The Slack profile-update notifier — diffs old vs new per field
    // One Supabase read covers all three.
    const before = await getUserByEmail(email)

    const updated = await updateUserProfile(email, update)

    if (updated && before && update.frequency !== undefined) {
      const wasNonDigest = !DIGEST_FREQUENCIES.has(before.frequency)
      const nowDigest = DIGEST_FREQUENCIES.has(update.frequency)
      if (wasNonDigest && nowDigest) {
        await markAllMatchesNotifiedForUser(updated.id)
      }
    }

    // Internal Slack alert. Build per-field {from, to} diffs from `before`;
    // only include fields that were in the request AND actually changed.
    // No-op saves (user clicked Save without changing anything) ship no
    // Slack message.
    if (updated && before) {
      const changes: Record<string, FieldChange> = {}
      const fieldPairs: Array<[keyof UserProfileUpdate, string]> = [
        ['location', before.location ?? ''],
        ['interest', before.interest ?? ''],
        ['employment', before.employment ?? ''],
        ['companySize', before.companySize ?? ''],
        ['frequency', before.frequency ?? ''],
        ['function', before.function ?? ''],
      ]
      for (const [key, fromVal] of fieldPairs) {
        if (update[key] === undefined) continue
        const toVal = String(update[key] ?? '')
        if (fromVal === toVal) continue
        changes[key as string] = { from: fromVal, to: toVal }
      }
      if (Object.keys(changes).length > 0) {
        waitUntil(
          notifyUserProfileUpdate({
            email,
            userId: updated.id,
            name: before.name,
            linkedin: before.linkedin,
            changes,
          }).catch((e) =>
            console.error('dashboard/profile: notifyUserProfileUpdate failed', e),
          ),
        )
      }
    }

    let rescoreFired = false
    if (updated && matchingInputsChanged) {
      // Detect a meaningful location change — submitted, non-empty, and
      // different from the prior value (case-insensitive trim). When it
      // fires we drop noEmail so the location-update branch of
      // process-matches can send the new-city digest. All other
      // matching-input changes stay silent (interests / employment /
      // size). Paused users are filtered out further downstream.
      const locationChanged =
        !!before &&
        typeof update.location === 'string' &&
        update.location.trim() !== '' &&
        update.location.trim().toLowerCase() !== (before.location ?? '').trim().toLowerCase()

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const flags = locationChanged ? 'locationChanged=1' : 'noEmail=1'
      waitUntil(
        fetch(`${appUrl}/api/process-matches?trigger=user&id=${updated.id}&${flags}`).catch((e) =>
          console.error('process-matches fire-and-forget error:', e),
        ),
      )
      rescoreFired = true
    }
    // `rescored` tells the client whether to surface the "AI is re-running
    // your matches" modal. False on no-op saves or pref-only changes
    // (frequency-only) so the editor closes silently in those cases.
    // `geocodeFailed` tells the LocationModal to stay open with a warning
    // when the city string couldn't be geocoded — matching by distance
    // won't work until the user corrects it.
    const geocodeFailed = updated?.geocodeFailed ?? false
    return NextResponse.json({ ok: true, rescored: rescoreFired, geocodeFailed })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/profile update error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
