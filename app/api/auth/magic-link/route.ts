import { NextRequest, NextResponse } from 'next/server'
import { getUserByEmail } from '@/lib/airtable'
import { createMagicToken } from '@/lib/supabase'
import { sendMagicLink } from '@/lib/email'

export async function POST(req: NextRequest) {
  const { email } = await req.json() as { email: string }

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

  const token = await createMagicToken(user.email)
  await sendMagicLink(user.email, token, req.nextUrl.origin)

  return NextResponse.json({ ok: true })
}
