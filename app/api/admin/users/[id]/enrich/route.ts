import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { getUserById } from '@/lib/users'
import { enrichUserFromLinkedIn } from '@/lib/enrich'

// Admin-triggered re-enrichment of an existing user. Reads the user's stored
// LinkedIn URL, calls AnySite, derives Function + Seniority, and writes back
// through updateUserAdmin (which mirrors to Supabase). Used when a profile
// signal changes after signup (admin tunes the keyword rules, user updates
// their LinkedIn, AnySite gets richer data, etc.) without forcing a new
// signup flow.

export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const userId = params.id
  if (!userId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  try {
    const user = await getUserById(userId)
    if (!user) {
      return NextResponse.json({ error: 'user not found' }, { status: 404 })
    }
    if (!user.linkedin) {
      return NextResponse.json(
        { error: 'user has no LinkedIn URL on record' },
        { status: 400 },
      )
    }
    const result = await enrichUserFromLinkedIn(userId, user.linkedin)
    if (!result.ok) {
      return NextResponse.json({ error: result.reason ?? 'enrichment failed' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/users/[id]/enrich error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
