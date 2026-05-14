import { NextRequest, NextResponse } from 'next/server'
import { getContributionStats } from '@/lib/supabase'

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
