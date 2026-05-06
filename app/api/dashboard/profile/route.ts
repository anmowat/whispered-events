import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/supabase'
import { updateUserProfile, UserProfileUpdate } from '@/lib/airtable'

export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value
  if (!sessionToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const email = await verifySession(sessionToken)
  if (!email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as UserProfileUpdate
  const update: UserProfileUpdate = {}
  if (typeof body.location === 'string') update.location = body.location
  if (typeof body.interest === 'string') update.interest = body.interest
  if (typeof body.employment === 'string') update.employment = body.employment
  if (typeof body.companySize === 'string') update.companySize = body.companySize

  // Mirror the application form rule — Size only meaningful when Employed
  if (update.employment && update.employment.toLowerCase() !== 'employed') {
    update.companySize = ''
  }

  try {
    const updated = await updateUserProfile(email, update)
    if (updated) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      fetch(`${appUrl}/api/process-matches?trigger=user&id=${updated.id}`).catch((e) =>
        console.error('process-matches fire-and-forget error:', e),
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/profile update error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
