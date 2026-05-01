import { NextResponse } from 'next/server'
import { getEventsCount } from '@/lib/airtable'

export const revalidate = 86400 // cache for 24 hours

export async function GET() {
  try {
    const raw = await getEventsCount()
    const count = Math.max(22, raw)
    return NextResponse.json({ count })
  } catch (err) {
    console.error('events-count error:', err)
    return NextResponse.json({ count: 22 })
  }
}
