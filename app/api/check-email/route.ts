import { NextRequest, NextResponse } from 'next/server'
import { getContributionCount } from '@/lib/airtable'

export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ contributions: 0 })
    }
    const contributions = await getContributionCount(email)
    return NextResponse.json({ contributions })
  } catch (err) {
    console.error('check-email error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ contributions: 0 })
  }
}
