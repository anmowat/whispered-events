import { NextRequest, NextResponse } from 'next/server'
import { createProfile } from '@/lib/airtable'
import { UserProfile } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { profile } = body as { profile: UserProfile }

    if (!profile.email || !profile.name) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      )
    }

    const id = await createProfile(profile)
    return NextResponse.json({ status: 'created', id })
  } catch (err) {
    console.error('submit-profile error:', err)
    return NextResponse.json(
      { error: 'Failed to submit profile' },
      { status: 500 }
    )
  }
}
