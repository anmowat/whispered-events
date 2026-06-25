import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicToken, createSession } from '@/lib/supabase'
import { getUserByEmail } from '@/lib/users'
import { safeNext } from '@/lib/auth-redirect'

// Two-step magic-link flow:
//   - GET  /api/auth/verify?token=... — does NOT consume the token.
//     Redirects to the /auth/login interstitial so email security
//     scanners can prefetch this URL all they want without burning
//     the token. Old emails (sent before the link moved to /auth/login)
//     keep working via this redirect.
//   - POST /api/auth/verify — consumed by the "Sign me in" button on
//     /auth/login. This is where the token is actually verified, the
//     session is created, and the cookie is set.

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/?auth=invalid', req.nextUrl.origin))
  }
  const url = new URL('/auth/login', req.nextUrl.origin)
  url.searchParams.set('token', token)
  // Pass next through to the interstitial so the form post downstream
  // still carries the user's intended destination. Backward-compat
  // emails without ?next just default to /dashboard server-side.
  const next = req.nextUrl.searchParams.get('next')
  if (next) url.searchParams.set('next', next)
  return NextResponse.redirect(url)
}

export async function POST(req: NextRequest) {
  // Accept either an HTML form post (the /auth/login button) or a JSON
  // body, so the same endpoint serves the interstitial form and any
  // future programmatic caller.
  let token: string | null = null
  let next: string | null = null
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as { token?: string; next?: string }
    token = body.token ?? null
    next = body.next ?? null
  } else {
    const form = await req.formData().catch(() => null)
    token = (form?.get('token') as string | null) ?? null
    next = (form?.get('next') as string | null) ?? null
  }

  if (!token) {
    return NextResponse.redirect(new URL('/?auth=invalid', req.nextUrl.origin), { status: 303 })
  }

  const email = await verifyMagicToken(token)
  if (!email) {
    return NextResponse.redirect(new URL('/?auth=invalid', req.nextUrl.origin), { status: 303 })
  }

  // Sessions are keyed by user_id; look up the user once at session-
  // create time so verifySession on every subsequent request can hand
  // both id and email to callers without another round-trip.
  const user = await getUserByEmail(email)
  if (!user) {
    return NextResponse.redirect(new URL('/?auth=invalid', req.nextUrl.origin), { status: 303 })
  }

  const sessionToken = await createSession(user.id, email)

  // safeNext re-validates the form value against the allow-list — even
  // a tampered URL can only land on a known internal route.
  const response = NextResponse.redirect(new URL(safeNext(next), req.nextUrl.origin), { status: 303 })
  response.cookies.set('session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 24 * 60 * 60,
    path: '/',
  })

  return response
}
