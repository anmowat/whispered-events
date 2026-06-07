import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import {
  clearEventMatchCheckbox,
  clearUserMatchCheckbox,
  refreshEventLatLon,
  refreshUserLatLon,
} from '@/lib/airtable'

// Webhook target for the Airtable "Match" automations.
//
//   User row Match checked  -> POST ?type=user&id=<recId>  -> rescore one user
//                              against every future event (sends digest if
//                              fresh matches above threshold and freq != Paused)
//   Event row Match checked -> POST ?type=event&id=<recId> -> rescore one event
//                              against every eligible user (no digest emails;
//                              admin-triggered, not user-facing).
//
// Both paths uncheck the box afterward so the admin can re-trigger.
function normalize(v: string | null | undefined): string {
  if (!v) return ''
  let s = v.trim()
  // Strip a single pair of surrounding quotes if present (Airtable sometimes wraps values)
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s
}

function fingerprint(v: string): string {
  if (!v) return '<empty>'
  const head = v.slice(0, 2)
  const tail = v.slice(-2)
  return `${head}…${tail}(len=${v.length})`
}

export async function POST(req: NextRequest) {
  const rawSecret = req.headers.get('x-webhook-secret')
  const rawExpected = process.env.AIRTABLE_WEBHOOK_SECRET
  const secret = normalize(rawSecret)
  const expected = normalize(rawExpected)
  if (!expected || secret !== expected) {
    console.log('airtable-rematch auth check:', {
      expectedFp: fingerprint(expected),
      receivedFp: fingerprint(secret),
      rawExpectedLen: rawExpected?.length ?? 0,
      rawReceivedLen: rawSecret?.length ?? 0,
      normalizedMatch: secret === expected,
    })
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const id = searchParams.get('id')

  if ((type !== 'user' && type !== 'event') || !id) {
    return NextResponse.json(
      { error: 'type=user|event and id are required' },
      { status: 400 },
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  if (type === 'user') {
    // Re-geocode in case an admin edited Location directly. Awaited so the
    // match fanout below sees the fresh LatLon.
    try {
      await refreshUserLatLon(id)
    } catch (err) {
      console.error('airtable-rematch: refreshUserLatLon failed:', err)
    }
    waitUntil(
      fetch(`${appUrl}/api/process-matches?trigger=user&id=${id}`).catch((e) =>
        console.error('airtable-rematch: user trigger fire-and-forget error:', e),
      ),
    )
    try {
      await clearUserMatchCheckbox(id)
    } catch (err) {
      console.error('airtable-rematch: clearUserMatchCheckbox failed:', err)
    }
    return NextResponse.json({ ok: true })
  }

  // type === 'event'
  // Re-geocode in case an admin edited Location directly on the event
  // row. Awaited so the match fanout below picks up fresh LatLon.
  try {
    await refreshEventLatLon(id)
  } catch (err) {
    console.error('airtable-rematch: refreshEventLatLon failed:', err)
  }
  // processEventTrigger invalidates both Airtable caches at entry, so
  // any field the admin just edited (description / audience / location
  // / type) is picked up on this rescore.
  waitUntil(
    fetch(`${appUrl}/api/process-matches?trigger=event&id=${id}`).catch((e) =>
      console.error('airtable-rematch: event trigger fire-and-forget error:', e),
    ),
  )
  try {
    await clearEventMatchCheckbox(id)
  } catch (err) {
    console.error('airtable-rematch: clearEventMatchCheckbox failed:', err)
  }
  return NextResponse.json({ ok: true })
}
