import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { isAdmin } from '@/lib/admin-auth'

// Manual cache-bust used by the /admin "Refresh content from Airtable"
// button. Flushes the three public homepage API responses (each cached
// 24h via `revalidate = 86400`). The next public visitor triggers a
// fresh fetch.
//
// The in-memory user / event caches that used to live in lib/airtable
// are gone with Phase 2 — there's nothing to bust there. User / event
// reads come from Supabase via lib/users + lib/events and reflect the
// latest synced state without app-side cache layers.
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

  return NextResponse.json({ ok: true, revalidated: PUBLIC_ROUTES })
}
