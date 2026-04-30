import { NextResponse } from 'next/server'
import { getEventsCount } from '@/lib/airtable'

export async function GET() {
  try {
    const count = await getEventsCount()
    return NextResponse.json({ count })
  } catch (err) {
    console.error('events-count error:', err)
    // Return 0 gracefully so the UI doesn't break
    return NextResponse.json({ count: 0 })
  }
}
