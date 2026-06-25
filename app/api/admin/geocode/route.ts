import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { geocodeLocation } from '@/lib/geocode'

// Admin-gated proxy for Nominatim. Browsers can't hit Nominatim directly
// (CORS + 1 req/sec rate limit, requires a real User-Agent header), so the
// admin filter UI POSTs city strings here. geocodeLocation already throttles
// and caches in-process so a session of repeated lookups for the same city
// is essentially free.

export const maxDuration = 15

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (!q) {
    return NextResponse.json({ error: 'q required' }, { status: 400 })
  }

  try {
    const result = await geocodeLocation(q)
    if (!result) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    return NextResponse.json({ lat: result.lat, lng: result.lng })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/geocode error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
