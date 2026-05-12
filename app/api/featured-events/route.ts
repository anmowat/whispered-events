import { NextResponse } from 'next/server'
import { getFeaturedEvents } from '@/lib/airtable'

export const revalidate = 86400 // cache for 24 hours

export async function GET() {
  try {
    const events = await getFeaturedEvents()
    return NextResponse.json({ events })
  } catch (err) {
    console.error('featured-events error:', err)
    return NextResponse.json({ events: [] })
  }
}
