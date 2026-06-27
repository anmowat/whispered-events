import { NextRequest, NextResponse } from 'next/server'
import { getUserByEmail } from '@/lib/users'

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email') || ''
  if (!email) return NextResponse.json({ exists: false })
  const user = await getUserByEmail(email)
  return NextResponse.json({ exists: !!user })
}
