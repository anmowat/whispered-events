import { NextRequest, NextResponse } from 'next/server'
import { createProfile } from '@/lib/airtable'
import { UserProfile } from '@/lib/types'

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
