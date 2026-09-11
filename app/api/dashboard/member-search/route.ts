import { NextRequest, NextResponse } from 'next/server'
import { verifySession, listShareContacts } from '@/lib/supabase'
import { searchMembersByName, getUserByEmail } from '@/lib/users'

// Name typeahead for the share-with-contacts picker.
//
// Returns name + LinkedIn and NEVER an email address. That's the same line the
// host match list draws (app/api/host/events/[id]/route.ts) - a member may
// learn who another member is, not how to mail them. Keeping the address
// server-side is what stops this becoming an email-harvesting tool: you can
// share with someone you found by name without ever seeing their address.

const RESULT_LIMIT = 8

export async function GET(req: NextRequest) {
  const token = req.cookies.get('session')?.value
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const session = await verifySession(token)
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  // searchMembersByName enforces this too; short-circuiting here saves the
  // round trip on the first keystroke of every search.
  if (q.length < 2) return NextResponse.json({ results: [] })

  try {
    // Over-fetch slightly: self and existing contacts are filtered out below,
    // and without headroom a search matching two people you've already added
    // would come back empty rather than showing the third.
    const [found, me, contacts] = await Promise.all([
      searchMembersByName(q, RESULT_LIMIT + 5),
      getUserByEmail(session.email),
      listShareContacts(session.userId),
    ])

    // Existing contacts are matched by email, which the client never sees -
    // resolving them to ids here keeps the comparison server-side.
    const contactUsers = await Promise.all(
      contacts.map((c) => getUserByEmail(c.contactEmail)),
    )
    const alreadySharing = new Set(
      contactUsers.filter((u) => u).map((u) => (u as { id: string }).id),
    )

    const results = found
      .filter((r) => r.userId !== session.userId && r.userId !== me?.id)
      .filter((r) => !alreadySharing.has(r.userId))
      .slice(0, RESULT_LIMIT)

    return NextResponse.json({ results })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/member-search error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
