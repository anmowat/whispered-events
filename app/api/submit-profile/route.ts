import { NextRequest, NextResponse } from 'next/server'
import { createProfile } from '@/lib/airtable'
import { sendUserAppliedEmail } from '@/lib/email'
import { enrichUserFromLinkedIn } from '@/lib/enrich'
import { UserProfile } from '@/lib/types'
import { upsertDigestState } from '@/lib/supabase'
import { nextSundayAfter } from '@/lib/digest'

// Per-request timeout extension — enrichment via AnySite can take 3–8s
// depending on LinkedIn profile depth. Signup latency goes up but the
// upside is a Function + Seniority already populated by the time admin
// loads the user detail page.
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

    const id = await createProfile(profile)

    // Seed monthly digest anchor: first monthly digest fires the Sunday after
    // signup, then advances 28 days each tick. Harmless for non-monthly users.
    try {
      await upsertDigestState(id, { nextMonthly: nextSundayAfter(new Date()) })
    } catch (e) {
      console.error('submit-profile: upsertDigestState error:', e)
    }

    // Enrichment from LinkedIn via AnySite. Replaces the Airtable
    // automation that used to fire on new-user creation. Awaited so the
    // request completes before the serverless function returns (fire-and-
    // forget is unreliable on Vercel). Failures must not break signup.
    if (profile.linkedin) {
      try {
        const result = await enrichUserFromLinkedIn(id, profile.linkedin)
        if (!result.ok) {
          console.warn(`submit-profile: enrichment skipped (${result.reason})`)
        }
      } catch (e) {
        console.error('submit-profile: enrichUserFromLinkedIn error:', e)
      }
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
