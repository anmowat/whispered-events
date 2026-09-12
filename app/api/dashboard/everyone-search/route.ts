import { NextRequest, NextResponse } from 'next/server'
import { verifySession, listSharersFor } from '@/lib/supabase'
import { searchEveryoneMembers } from '@/lib/users'

// Name typeahead over members who set share_visibility = 'everyone' - the pool
// behind "Search users" in the View Events modal.
//
// Same disclosure rule as member-search: name and LinkedIn, never an email.
// Independent of the target's `findable` setting, because that governs how
// people reach THEM while this governs who can see THEIR events.

const RESULT_LIMIT = 8

export async function GET(req: NextRequest) {
  const token = req.cookies.get('session')?.value
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json({ results: [] })

  try {
    // Over-fetch: self and anyone already visible to me are filtered out
    // below, and without headroom a search matching two people I already
    // follow would come back empty instead of showing the third.
    const [found, mine] = await Promise.all([
      searchEveryoneMembers(q, RESULT_LIMIT + 5),
      listSharersFor(session.email),
    ])
    const alreadyVisible = new Set(mine.map((r) => r.ownerUserId))

    const results = found
      .filter((r) => r.userId !== session.userId)
      .filter((r) => !alreadyVisible.has(r.userId))
      .slice(0, RESULT_LIMIT)

    return NextResponse.json({ results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/everyone-search error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
