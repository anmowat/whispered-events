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

    // Fire-and-forget: trigger matching for the new user
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    fetch(`${appUrl}/api/process-matches?trigger=user&id=${id}`).catch((e) =>
      console.error('process-matches fire-and-forget error:', e)
    )

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
