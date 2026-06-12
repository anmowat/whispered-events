import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isAdmin } from '@/lib/admin-auth'
import { invalidateUserCache, invalidateEventCache } from '@/lib/airtable'

// Manual cache-bust used by the /admin "Refresh content from Airtable"
// button. Flushes the three public homepage API responses (each cached
// 24h via `revalidate = 86400`) plus the in-memory user / event caches
// (90s lazy cache used by cron + matching). The next public visitor
// triggers a fresh Airtable fetch.
//
// No body required. Returns the list of paths that were revalidated so
// the admin UI can confirm.

const PUBLIC_ROUTES = [
  '/api/partners',
  '/api/events-count',
  '/api/featured-events',
]

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  for (const path of PUBLIC_ROUTES) {
    revalidatePath(path)
  }
  invalidateUserCache()
  invalidateEventCache()

  return NextResponse.json({ ok: true, revalidated: PUBLIC_ROUTES })
}
