import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicToken, createSession } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/?auth=invalid', req.nextUrl.origin))
  }

  const email = await verifyMagicToken(token)

  if (!email) {
    return NextResponse.redirect(new URL('/?auth=invalid', req.nextUrl.origin))
  }

  const sessionToken = await createSession(email)

  const response = NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin))
  response.cookies.set('session', sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  })

  return response
}
