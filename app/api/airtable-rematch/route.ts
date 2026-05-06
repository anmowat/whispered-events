import { NextRequest, NextResponse } from 'next/server'
import { clearUserMatchCheckbox } from '@/lib/airtable'

// Webhook target for the Airtable "User Match" automation.
// When a team member checks the `Match` box on a User row, Airtable POSTs here.
// We fire a fanout match run, then uncheck the box so the team can re-trigger.
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

  if (type !== 'user' || !id) {
    return NextResponse.json({ error: 'type=user and id are required' }, { status: 400 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  fetch(`${appUrl}/api/process-matches?trigger=user&id=${id}`).catch((e) =>
    console.error('airtable-rematch: process-matches fire-and-forget error:', e),
  )

  try {
    await clearUserMatchCheckbox(id)
  } catch (err) {
    console.error('airtable-rematch: clearUserMatchCheckbox failed:', err)
  }

  return NextResponse.json({ ok: true })
}
