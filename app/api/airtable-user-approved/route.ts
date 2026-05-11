import { NextRequest, NextResponse } from 'next/server'
import { getUserById } from '@/lib/airtable'
import { sendUserApprovedEmail } from '@/lib/email'

// Webhook target for the Airtable "User Approved" automation.
// Configure Airtable to POST here when a user record transitions to Approved.
// Required: x-webhook-secret header matching AIRTABLE_WEBHOOK_SECRET, ?id=<userId>.

function normalize(v: string | null | undefined): string {
  if (!v) return ''
  let s = v.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s
}

export async function POST(req: NextRequest) {
  const expected = normalize(process.env.AIRTABLE_WEBHOOK_SECRET)
  const received = normalize(req.headers.get('x-webhook-secret'))
  if (!expected || received !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const id = new URL(req.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const user = await getUserById(id)
  if (!user || !user.email) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 })
  }

  try {
    await sendUserApprovedEmail(user.email, user.name)
  } catch (e) {
    console.error('airtable-user-approved: sendUserApprovedEmail failed', e)
    return NextResponse.json({ error: 'send failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
