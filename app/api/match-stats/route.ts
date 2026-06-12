import { NextResponse } from 'next/server'
import { getRecentNotifiedMatchCount } from '@/lib/supabase'

// Public stats endpoint — powers the "X event matches last 30 days"
// chip under the homepage CTA. Cached at the route layer for 1h so
// homepage traffic doesn't fan out into Supabase. Admin "Refresh from
// Airtable" doesn't touch this — it'll catch up on its own clock.

export const revalidate = 3600

export async function GET() {
  try {
    const matches30 = await getRecentNotifiedMatchCount(30)
    return NextResponse.json({ matches30 })
  } catch (err) {
    console.error('match-stats error:', err)
    return NextResponse.json({ matches30: 0 })
  }
}
