import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/supabase'
import { getUserByEmail } from '@/lib/airtable'

export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value

  if (!sessionToken) {
    return NextResponse.json({ user: null })
  }

  const email = await verifySession(sessionToken)

  if (!email) {
    return NextResponse.json({ user: null })
  }

  const user = await getUserByEmail(email)

  if (!user) {
    return NextResponse.json({ user: null })
  }

  return NextResponse.json({
    user: {
      email: user.email,
      name: user.name,
      interest: user.interest,
    },
  })
}
