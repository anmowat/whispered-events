import { NextRequest, NextResponse } from 'next/server'
import { getUserByEmail } from '@/lib/airtable'
import { createSession } from '@/lib/supabase'

// TEMPORARY: dev login — bypasses magic-link email send. Anyone who knows
// a user's email can log in as them. Remove or gate before going live with
// real users by switching LoginModal back to /api/auth/magic-link.
export async function POST(req: NextRequest) {
  const { email } = (await req.json()) as { email: string }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'valid_email_required' }, { status: 400 })
  }

  try {
    const user = await getUserByEmail(email.toLowerCase().trim())

    if (!user) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    if (!user.active) {
      return NextResponse.json({ error: 'inactive' }, { status: 403 })
    }

    const sessionToken = await createSession(user.email)

    const response = NextResponse.json({ ok: true })
    response.cookies.set('session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })
    return response
  } catch (err) {
    console.error('[dev-login] failed', err)
    const message = err instanceof Error ? err.message : 'unknown_error'
    return NextResponse.json({ error: 'server_error', message }, { status: 500 })
  }
}
