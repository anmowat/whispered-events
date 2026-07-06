import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createProfile } from '@/lib/airtable'
import { sendUserAppliedEmail } from '@/lib/email'
import { enrichUserFromLinkedIn } from '@/lib/enrich'
import { notifyNewUser } from '@/lib/slack'
import { UserProfile } from '@/lib/types'
import { upsertDigestState } from '@/lib/supabase'
import { nextSundayAfter } from '@/lib/digest'

// maxDuration covers the foreground path (createProfile + email) plus any
// background work waitUntil keeps alive after the response. Vercel kills
// the function process at this deadline regardless, so enrichment must
// fit inside it — AnySite takes 3-8s, so 60s leaves comfortable headroom.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { profile } = body as { profile: UserProfile }

    if (!profile.email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const { id, isNew } = await createProfile(profile)

    // Fire the internal Slack alert for brand-new signups only. Returning
    // users who re-submit the form (e.g. to fix a typo) don't ping. Runs in
    // the background — Slack outages don't block the response.
    if (isNew) {
      waitUntil(
        notifyNewUser(profile, id).catch((e) =>
          console.error('submit-profile: notifyNewUser failed', e),
        ),
      )
    }

    // Seed monthly digest anchor: first monthly digest fires the Sunday after
    // signup, then advances 28 days each tick. Harmless for non-monthly users.
    try {
      await upsertDigestState(id, { nextMonthly: nextSundayAfter(new Date()) })
    } catch (e) {
      console.error('submit-profile: upsertDigestState error:', e)
    }

    // Enrichment runs in the background after the response is sent. waitUntil
    // tells Vercel to keep the function alive until the promise settles, so
    // the user isn't waiting 3-8s for AnySite. Replaces the awaited call we
    // shipped initially in 60697f8 — that put enrichment on the critical
    // path and added unacceptable signup latency.
    //
    // Failures inside the wrapped promise are logged but never surface to
    // the user (the response has already returned). Outside Vercel,
    // @vercel/functions' waitUntil is a no-op that still runs the promise;
    // local dev keeps the existing await semantics implicitly.
    if (profile.linkedin) {
      waitUntil(
        (async () => {
          try {
            const result = await enrichUserFromLinkedIn(id, profile.linkedin)
            if (!result.ok) {
              console.warn(`submit-profile: enrichment skipped (${result.reason})`)
            } else {
              console.log(
                `submit-profile: enriched ${id} → ${result.function || '?'} / ${result.seniority || '?'}`,
              )
            }
          } catch (e) {
            console.error('submit-profile: enrichUserFromLinkedIn error:', e)
          }
        })(),
      )
    }

    // Awaited so the in-flight Resend request isn't killed when the
    // serverless function returns. Failures here must not break signup.
    try {
      await sendUserAppliedEmail(profile.email)
    } catch (e) {
      console.error('submit-profile: sendUserAppliedEmail error:', e)
    }

    // Match runs are kicked off by the team via the Airtable `Match` checkbox
    // after the user is enriched (Grade, Function, Seniority).
    return NextResponse.json({ status: 'created', id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('submit-profile error:', message)
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
