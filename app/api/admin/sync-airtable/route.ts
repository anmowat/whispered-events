import { NextRequest, NextResponse } from 'next/server'
import { syncUsersToCache, syncEventsToCache } from '@/lib/sync'

// Manual trigger for the Airtable → Supabase sync. Use for initial seed and
// for forcing a fresh pull when debugging. Production traffic should be
// handled by the cron at /api/cron/sync-airtable.
//
// Auth: either the x-webhook-secret header matching AIRTABLE_WEBHOOK_SECRET,
// OR an Authorization: Bearer <CRON_SECRET> header (matches the cron route).
// Optional ?only=users or ?only=events to sync just one table.

export const maxDuration = 300

function normalize(v: string | null | undefined): string {
  if (!v) return ''
  let s = v.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s
}

function isAuthorized(req: NextRequest): boolean {
  const webhookSecret = normalize(process.env.AIRTABLE_WEBHOOK_SECRET)
  const sentWebhook = normalize(req.headers.get('x-webhook-secret'))
  if (webhookSecret && sentWebhook === webhookSecret) return true

  const cronSecret = normalize(process.env.CRON_SECRET)
  const auth = req.headers.get('authorization') || ''
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true

  return false
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const only = new URL(req.url).searchParams.get('only')

  try {
    const stats: Record<string, unknown> = {}
    if (only !== 'events') {
      stats.users = await syncUsersToCache()
    }
    if (only !== 'users') {
      stats.events = await syncEventsToCache()
    }
    return NextResponse.json({ ok: true, stats })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/sync-airtable error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET mirror for ad-hoc testing in a browser — same auth.
export async function GET(req: NextRequest) {
  return POST(req)
}
