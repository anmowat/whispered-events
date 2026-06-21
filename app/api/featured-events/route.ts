import { NextResponse } from 'next/server'
import { getFeaturedEvents } from '@/lib/events'

// Tight revalidation now that this is Supabase-backed: admin flips
// a Feature checkbox, runs a sync, and expects the carousel to update
// within a minute. The old 24h cache was a workaround for Airtable's
// rate limit + signed-URL TTL, both irrelevant on the Supabase path.
export const revalidate = 60

export async function GET() {
  try {
    const events = await getFeaturedEvents()
    return NextResponse.json({ events })
  } catch (err) {
    console.error('featured-events error:', err)
    return NextResponse.json({ events: [] })
  }
}
