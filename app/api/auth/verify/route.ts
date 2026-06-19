import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicToken, createSession } from '@/lib/supabase'

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
  return NextResponse.redirect(url)
}

export async function POST(req: NextRequest) {
  // Accept either an HTML form post (the /auth/login button) or a JSON
  // body, so the same endpoint serves the interstitial form and any
  // future programmatic caller.
  let token: string | null = null
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as { token?: string }
    token = body.token ?? null
  } else {
    const form = await req.formData().catch(() => null)
    token = (form?.get('token') as string | null) ?? null
  }

  if (!token) {
    return NextResponse.redirect(new URL('/?auth=invalid', req.nextUrl.origin), { status: 303 })
  }

  const email = await verifyMagicToken(token)
  if (!email) {
    return NextResponse.redirect(new URL('/?auth=invalid', req.nextUrl.origin), { status: 303 })
  }

  const sessionToken = await createSession(email)

  const response = NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin), { status: 303 })
  response.cookies.set('session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 24 * 60 * 60,
    path: '/',
  })

  return response
}
