import { NextRequest, NextResponse } from 'next/server'
import { getUserByEmail } from '@/lib/users'
import { createMagicToken } from '@/lib/supabase'
import { sendMagicLink } from '@/lib/email'
import { safeNext } from '@/lib/auth-redirect'

export async function POST(req: NextRequest) {
  const { email, next } = (await req.json()) as { email: string; next?: string }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'valid_email_required' }, { status: 400 })
  }

  const user = await getUserByEmail(email.toLowerCase().trim())

  if (!user) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (!user.active) {
    return NextResponse.json({ error: 'inactive' }, { status: 403 })
  }

  try {
    const token = await createMagicToken(user.email)
    // safeNext drops unknown destinations silently — a tampered or
    // mistyped value just falls back to /dashboard rather than
    // rejecting the whole login.
    await sendMagicLink(user.email, token, req.nextUrl.origin, safeNext(next))
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[magic-link] failed', { email: user.email, message, err })
    return NextResponse.json({ error: 'send_failed', message }, { status: 500 })
  }
}
