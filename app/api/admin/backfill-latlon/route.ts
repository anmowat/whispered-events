import { NextRequest, NextResponse } from 'next/server'
import Airtable from 'airtable'
import { geocodeLocation } from '@/lib/geocode'

// Idempotent backfill: scans Users and Events, geocodes Location, and writes
// LatLon when missing or stale. Auth via the same shared webhook secret.
// Safe to re-run.
//
// Geocoding goes through Nominatim which is throttled to ~1 req/sec, so
// large tables can take a while. Bump the function timeout accordingly.
export const maxDuration = 300

function normalize(v: string | null | undefined): string {
  if (!v) return ''
  let s = v.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s
}

interface TableStats {
  scanned: number
  updated: number
  unchanged: number
  noLocation: number
  ungeocodable: number
  errors: number
  ungeocodableSamples: string[]
}

async function backfillTable(table: string): Promise<TableStats> {
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base('appK8AqOvtEgIquRT')
  const stats: TableStats = {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    noLocation: 0,
    ungeocodable: 0,
    errors: 0,
    ungeocodableSamples: [],
  }

  const records = await base(table).select({ fields: ['Location', 'LatLon'] }).all()
  for (const record of records) {
    stats.scanned++
    const location = String(record.get('Location') || '').trim()
    if (!location) {
      stats.noLocation++
      continue
    }
    const geo = await geocodeLocation(location)
    if (!geo) {
      stats.ungeocodable++
      if (stats.ungeocodableSamples.length < 10) stats.ungeocodableSamples.push(location)
      continue
    }
    const fresh = `${geo.lat},${geo.lng}`
    const current = String(record.get('LatLon') || '').trim()
    if (current === fresh) {
      stats.unchanged++
      continue
    }
    try {
      await base(table).update(record.id, { LatLon: fresh })
      stats.updated++
    } catch (err) {
      stats.errors++
      console.error(`backfill-latlon: update failed on ${table}/${record.id}`, err)
    }
  }
  return stats
}

export async function POST(req: NextRequest) {
  const secret = normalize(req.headers.get('x-webhook-secret'))
  const expected = normalize(process.env.AIRTABLE_WEBHOOK_SECRET)
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const users = await backfillTable('Users')
    const events = await backfillTable('Events')
    return NextResponse.json({ ok: true, users, events })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('backfill-latlon: failed', err)
    return NextResponse.json({ error: 'server_error', message }, { status: 500 })
  }
}
