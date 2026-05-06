import { NextRequest, NextResponse } from 'next/server'
import { clearUserMatchCheckbox } from '@/lib/airtable'

// Webhook target for the Airtable "User Match" automation.
// When a team member checks the `Match` box on a User row, Airtable POSTs here.
// We fire a fanout match run, then uncheck the box so the team can re-trigger.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-webhook-secret')
  const expected = process.env.AIRTABLE_WEBHOOK_SECRET
  if (!expected || secret !== expected) {
    console.log('airtable-rematch auth check:', {
      expectedDefined: !!expected,
      expectedLen: expected?.length ?? 0,
      receivedDefined: !!secret,
      receivedLen: secret?.length ?? 0,
      match: secret === expected,
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
