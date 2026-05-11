import { NextRequest, NextResponse } from 'next/server'
import { createProfile } from '@/lib/airtable'
import { sendUserAppliedEmail } from '@/lib/email'
import { UserProfile } from '@/lib/types'
import { upsertDigestState } from '@/lib/supabase'
import { nextSundayAfter } from '@/lib/digest'

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

    // Awaited so the in-flight Resend request isn't killed when the
    // serverless function returns. Failures here must not break signup.
    try {
      await sendUserAppliedEmail(profile.email)
    } catch (e) {
      console.error('submit-profile: sendUserAppliedEmail error:', e)
    }

    // Match runs are kicked off by the team via the Airtable `Match` checkbox
    // after the user is enriched (Grade, Function, Seniority — FullExp optional).
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
