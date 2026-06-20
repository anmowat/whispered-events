import { NextRequest, NextResponse } from 'next/server'
import { getContributionStats } from '@/lib/supabase'
import { getUserByEmail } from '@/lib/users'

export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ contributions: 0 })
    }
    const { total } = await getContributionStats(email)
    return NextResponse.json({ contributions: total })
  } catch (err) {
    console.error('check-email error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ contributions: 0 })
  }
}

// Lightweight existence check used by /welcome so it can redirect
// repeat visitors home instead of letting them re-submit. Returns
// { exists: boolean } only.
export async function GET(req: NextRequest) {
  const email = (req.nextUrl.searchParams.get('email') || '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ exists: false })
  }
  try {
    const user = await getUserByEmail(email)
    return NextResponse.json({ exists: Boolean(user) })
  } catch (err) {
    console.error('check-email GET error:', err instanceof Error ? err.message : String(err))
    // Fail open: don't trap the visitor on a redirect they didn't ask
    // for if Airtable is flaky — let them see the form.
    return NextResponse.json({ exists: false })
  }
}
