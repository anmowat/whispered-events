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

type Rating = 'interested' | 'skip' | 'not_a_fit'

function normalizeRating(raw: string | null): Rating | null {
  if (raw == null) return null
  const mapped = RATING_ALIASES[raw] ?? raw
  return mapped === 'interested' || mapped === 'skip' || mapped === 'not_a_fit' ? mapped : null
}

function thanksUrl(rating: Rating, eventId: string): string {
  // Skip has no follow-up UI, so it doesn't need the event.
  return rating === 'skip'
    ? `${BASE_URL}/rate/thanks?rating=skip`
    : `${BASE_URL}/rate/thanks?rating=${rating}&eventId=${encodeURIComponent(eventId)}`
}

// GET is deliberately non-mutating.
//
// This used to record the rating directly, which meant anything that merely
// fetched the URL recorded one. Corporate mail security (Safe Links, Proofpoint
// and similar) fetches every link in an inbound message to vet it, so a single
// digest produced a rating on every event for all three buttons — and a Slack
// notification for each. RFC 9110 is explicit that GET must be safe; this now
// just hands off to /rate, which submits the rating from the reader's browser.
//
// Kept rather than removed because emails already in inboxes point here. Those
// links keep working, and become safe retroactively.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const rating = normalizeRating(req.nextUrl.searchParams.get('rating'))
  if (!rating || !verifyRatingToken(token)) {
    return NextResponse.redirect(`${BASE_URL}/rate/thanks?error=invalid`)
  }
  return NextResponse.redirect(
    `${BASE_URL}/rate?token=${encodeURIComponent(token)}&rating=${rating}`,
  )
}

// POST performs the rating. Reached two ways: the /rate page submits it via
// fetch on load (the normal path — no extra click), or the <noscript> form on
// that page posts it directly when JavaScript is unavailable.
export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')

  let token = ''
  let ratingRaw: string | null = null
  if (isJson) {
    const body = (await req.json().catch(() => ({}))) as { token?: string; rating?: string }
    token = body.token ?? ''
    ratingRaw = body.rating ?? null
  } else {
    const form = await req.formData().catch(() => null)
    token = String(form?.get('token') ?? '')
    ratingRaw = form?.get('rating') != null ? String(form.get('rating')) : null
  }

  const rating = normalizeRating(ratingRaw)
  const parsed = rating ? verifyRatingToken(token) : null
  if (!rating || !parsed) {
    return isJson
      ? NextResponse.json({ error: 'invalid' }, { status: 400 })
      : NextResponse.redirect(`${BASE_URL}/rate/thanks?error=invalid`, { status: 303 })
  }

  const { userId, eventId } = parsed

  try {
    // setMatchRating returns false when the value is unchanged. Honouring that
    // is what keeps a re-submission from firing a duplicate Slack message —
    // this path previously discarded the result and notified every time.
    const changed = await setMatchRating({ eventId, userId, rating, reason: null })
    void touchEmailLastSeen(userId)

    if (changed) {
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
        })(),
      )
    }
  } catch (err) {
    console.error('email rate error:', err instanceof Error ? err.message : String(err))
    return isJson
      ? NextResponse.json({ error: 'failed' }, { status: 500 })
      : NextResponse.redirect(`${BASE_URL}/rate/thanks?error=invalid`, { status: 303 })
  }

  return isJson
    ? NextResponse.json({ ok: true, rating, eventId })
    : NextResponse.redirect(thanksUrl(rating, eventId), { status: 303 })
}
