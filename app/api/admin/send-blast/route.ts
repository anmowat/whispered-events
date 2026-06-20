import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { getActiveUsers } from '@/lib/users'
import { sendBlast } from '@/lib/email'

// Admin-only broadcast send. Looks up each recipient by Airtable id,
// then fires one Resend send per user (BCC andy@whisperedevents.com is
// applied in lib/email.ts). Returns per-recipient success/failure so
// the admin UI can surface partial failures.
//
// Sends serially with a tiny pause to stay polite under Resend's rate
// limit. At ~50 recipients per blast this comfortably fits the 300s
// function ceiling.

export const maxDuration = 300

// Resend's free tier allows 5 req/sec. Pause this long between sends
// so we stay safely under (4/sec). 250 chosen to match the cron-digest
// throttle in lib/digest.ts for one consistent number to tune.
const RATE_LIMIT_DELAY_MS = 250

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { userIds?: string[]; subject?: string; body?: string }
  try {
    body = (await req.json()) as { userIds?: string[]; subject?: string; body?: string }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const userIds = Array.isArray(body.userIds) ? body.userIds.filter(Boolean) : []
  const subject = (body.subject || '').trim()
  const messageBody = (body.body || '').trim()
  if (userIds.length === 0) {
    return NextResponse.json({ error: 'userIds required' }, { status: 400 })
  }
  if (!subject || !messageBody) {
    return NextResponse.json({ error: 'subject and body required' }, { status: 400 })
  }

  const allUsers = await getActiveUsers()
  const byId = new Map(allUsers.map((u) => [u.id, u]))
  const recipients = userIds
    .map((id) => byId.get(id))
    .filter((u): u is NonNullable<typeof u> => !!u && !!u.email)

  let ok = 0
  const failed: { email: string; error: string }[] = []
  for (const user of recipients) {
    try {
      await sendBlast(user, subject, messageBody)
      ok += 1
    } catch (err) {
      failed.push({
        email: user.email,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    await sleep(RATE_LIMIT_DELAY_MS)
  }

  return NextResponse.json({ ok, failed })
}
