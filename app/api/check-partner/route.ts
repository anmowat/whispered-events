import { NextRequest, NextResponse } from 'next/server'
import { getPartnerUserByEmail } from '@/lib/airtable'

// Tiny lookup used by the contribute review card to decide whether to show
// the "only partners can claim Host" inline notice. We default to false on
// any error so a transient Airtable hiccup just nudges the user toward
// reading the notice — safer than silently letting a non-partner think
// their claim will work.

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ isPartner: false })
    }
    const partner = await getPartnerUserByEmail(email)
    return NextResponse.json({ isPartner: !!partner })
  } catch (err) {
    console.error('check-partner error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ isPartner: false })
  }
}
