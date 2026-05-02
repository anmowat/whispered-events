import { NextRequest, NextResponse } from 'next/server'
import { deleteSession } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value

  if (sessionToken) {
    await deleteSession(sessionToken)
  }

  const response = NextResponse.redirect(new URL('/', req.nextUrl.origin))
  response.cookies.set('session', '', { maxAge: 0, path: '/' })

  return response
}
