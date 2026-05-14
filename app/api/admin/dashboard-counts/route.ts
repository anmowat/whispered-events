import { NextRequest, NextResponse } from 'next/server'
import { verifySession, getMatchCountsByEmail } from '@/lib/supabase'
import { getActiveUsers, getFutureEvents } from '@/lib/airtable'

// Admin overview: returns each active user's email + how many matches they
// would currently see on their personal dashboard. Sub-second via one bulk
// Supabase query plus the 90s-cached Airtable reads.
//
// Auth: session cookie email must be in ADMIN_EMAILS (comma-separated env var).

export const maxDuration = 60

async function isAdmin(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get('session')?.value
  if (!token) return false
  const email = await verifySession(token)
  if (!email) return false
  const allow = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return allow.includes(email.toLowerCase())
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const [activeUsers, futureEvents] = await Promise.all([
      getActiveUsers(),
      getFutureEvents(),
    ])
    const futureEventIds = futureEvents.map((e) => e.id)
    const counts = await getMatchCountsByEmail(futureEventIds)

    const users = activeUsers
      .filter((u) => u.email)
      .map((u) => ({
        email: u.email,
        matchCount: counts.get(u.email) ?? 0,
      }))
      .sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount
        return a.email.localeCompare(b.email)
      })

    return NextResponse.json({
      users,
      stats: {
        activeUserCount: users.length,
        futureEventCount: futureEvents.length,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/dashboard-counts error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
