import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { searchUsersByName } from '@/lib/users'

// Admin-only name/email typeahead used by the admin event detail page's host
// picker. Returns up to 10 matches per request, smallest payload that fits a
// useful dropdown without overwhelming a wide query.

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const q = req.nextUrl.searchParams.get('q') || ''
  if (!q.trim()) return NextResponse.json({ results: [] })
  try {
    const users = await searchUsersByName(q, 10)
    return NextResponse.json({
      results: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        firstName: u.firstName,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/users/search error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
