import { NextRequest, NextResponse } from 'next/server'
import { verifyRatingToken } from '@/lib/email-rating'
import { setMatchRating } from '@/lib/supabase'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://whisperedevents.com'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const rating = req.nextUrl.searchParams.get('rating')

  if (rating !== 'up' && rating !== 'down') {
    return NextResponse.redirect(`${BASE_URL}/rate/thanks?error=invalid`)
  }

  const parsed = verifyRatingToken(token)
  if (!parsed) {
    return NextResponse.redirect(`${BASE_URL}/rate/thanks?error=invalid`)
  }

  const { userId, eventId } = parsed

  try {
    await setMatchRating({ eventId, userId, rating, reason: null })
  } catch (err) {
    console.error('email rate error:', err instanceof Error ? err.message : String(err))
  }

  const dest =
    rating === 'up'
      ? `${BASE_URL}/rate/thanks?rating=up`
      : `${BASE_URL}/rate/thanks?rating=down&eventId=${encodeURIComponent(eventId)}`

  return NextResponse.redirect(dest)
}
