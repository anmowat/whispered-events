import { NextRequest, NextResponse } from 'next/server'
import { verifyRatingToken } from '@/lib/email-rating'
import { setMatchRating, touchEmailLastSeen } from '@/lib/supabase'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://whisperedevents.com'

// Map legacy email link values to current DB values (emails already sent).
const RATING_ALIASES: Record<string, string> = { going: 'interested', cant_make_it: 'hide' }

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const raw = req.nextUrl.searchParams.get('rating')
  const rating = raw != null ? (RATING_ALIASES[raw] ?? raw) : raw

  if (rating !== 'interested' && rating !== 'hide' && rating !== 'not_a_fit') {
    return NextResponse.redirect(`${BASE_URL}/rate/thanks?error=invalid`)
  }

  const parsed = verifyRatingToken(token)
  if (!parsed) {
    return NextResponse.redirect(`${BASE_URL}/rate/thanks?error=invalid`)
  }

  const { userId, eventId } = parsed

  try {
    await setMatchRating({ eventId, userId, rating, reason: null })
    void touchEmailLastSeen(userId)
  } catch (err) {
    console.error('email rate error:', err instanceof Error ? err.message : String(err))
  }

  const dest = rating === 'not_a_fit'
    ? `${BASE_URL}/rate/thanks?rating=not_a_fit&eventId=${encodeURIComponent(eventId)}`
    : `${BASE_URL}/rate/thanks?rating=${rating}`

  return NextResponse.redirect(dest)
}
