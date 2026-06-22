import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { getUserByEmail } from '@/lib/users'

// Admin-only email -> {id, name, email} lookup. Used by the admin event
// detail page to resolve typed host emails into user ids before save.
// Same isAdmin gate as the rest of /api/admin.

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const email = req.nextUrl.searchParams.get('email') || ''
  if (!email.trim()) {
    return NextResponse.json({ error: 'email required' }, { status: 400 })
  }
  try {
    const user = await getUserByEmail(email)
    if (!user) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/users/lookup error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
