import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { verifyRatingToken } from '@/lib/email-rating'
import { setMatchRating, touchEmailLastSeen } from '@/lib/supabase'
import { getUserById } from '@/lib/users'
import { getEventById } from '@/lib/events'
import { sendMatchRatingNotification } from '@/lib/email'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://whisperedevents.com'

// Map legacy email link values to current DB values (emails already sent).
const RATING_ALIASES: Record<string, string> = { going: 'interested', cant_make_it: 'skip' }

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const raw = req.nextUrl.searchParams.get('rating')
  const rating = raw != null ? (RATING_ALIASES[raw] ?? raw) : raw

  if (rating !== 'interested' && rating !== 'skip' && rating !== 'not_a_fit') {
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

    waitUntil(
      (async () => {
        try {
          const [user, event] = await Promise.all([getUserById(userId), getEventById(eventId)])
          if (!user || !event) return
          await sendMatchRatingNotification({
            userId,
            userName: user.name || '',
            userEmail: user.email,
            userLinkedin: user.linkedin || null,
            userCreated: user.created || null,
            eventName: event.name,
            rating,
            reason: null,
          })
        } catch (err) {
          console.error('email rate notification error:', err instanceof Error ? err.message : String(err))
        }
      })()
    )
  } catch (err) {
    console.error('email rate error:', err instanceof Error ? err.message : String(err))
  }

  const dest = rating === 'skip'
    ? `${BASE_URL}/rate/thanks?rating=skip`
    : `${BASE_URL}/rate/thanks?rating=${rating}&eventId=${encodeURIComponent(eventId)}`

  return NextResponse.redirect(dest)
}
