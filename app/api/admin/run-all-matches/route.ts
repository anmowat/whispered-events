import { NextRequest, NextResponse } from 'next/server'
import { getActiveUsers } from '@/lib/users'
import { isMatchEligible } from '@/lib/matching'

// Re-runs matching for every active, eligible user. Auth via the shared
// webhook secret. Pass ?noEmail=1 to suppress digest emails (recommended
// for the first big backfill so users don't get a flood).
//
// Fans out to /api/process-matches per user with bounded concurrency so
// Vercel runs each user in its own function invocation.
export const maxDuration = 300

function normalize(v: string | null | undefined): string {
  if (!v) return ''
  let s = v.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s
}

export async function POST(req: NextRequest) {
  const got = normalize(req.headers.get('x-webhook-secret'))
  const expected = normalize(process.env.AIRTABLE_WEBHOOK_SECRET)
  if (!expected || got !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const noEmail = req.nextUrl.searchParams.get('noEmail') === '1'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const allUsers = await getActiveUsers()
  const users = allUsers.filter(isMatchEligible)
  const ineligible = allUsers.length - users.length

  const CONCURRENCY = 5
  const results: { id: string; email: string; ok: boolean; status?: number }[] = []

  for (let i = 0; i < users.length; i += CONCURRENCY) {
    const batch = users.slice(i, i + CONCURRENCY)
    const settled = await Promise.all(
      batch.map(async (u) => {
        const url = `${appUrl}/api/process-matches?trigger=user&id=${u.id}${noEmail ? '&noEmail=1' : ''}`
        try {
          const res = await fetch(url)
          return { id: u.id, email: u.email, ok: res.ok, status: res.status }
        } catch (err) {
          console.error(`run-all-matches: ${u.email} fetch failed:`, err)
          return { id: u.id, email: u.email, ok: false }
        }
      }),
    )
    results.push(...settled)
  }

  return NextResponse.json({
    ok: true,
    total: users.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    skippedIneligible: ineligible,
    noEmail,
  })
}
