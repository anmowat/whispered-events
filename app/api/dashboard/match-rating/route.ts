import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { verifySession, setMatchRating, MatchRating } from '@/lib/supabase'
import { getUserByEmail, getEventById } from '@/lib/airtable'
import { sendMatchRatingNotification } from '@/lib/email'

// Writes the dashboard thumbs-up / thumbs-down (or clears it) onto the
// matches row for the (event, user) pair, then fires a fire-and-forget
// internal notification email so Andy can see the rating in real time.
// The notification is best-effort — a Resend hiccup must not block the
// user's UI from confirming the rating landed.
export async function POST(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value
  if (!sessionToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const email = await verifySession(sessionToken)
  if (!email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json()) as {
    eventId?: unknown
    rating?: unknown
    reason?: unknown
  }

  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
  if (!eventId) {
    return NextResponse.json({ error: 'eventId required' }, { status: 400 })
  }

  // null = clear. We accept 'up' / 'down' / null only.
  let rating: MatchRating | null
  if (body.rating === null) {
    rating = null
  } else if (body.rating === 'up' || body.rating === 'down') {
    rating = body.rating
  } else {
    return NextResponse.json({ error: 'invalid rating' }, { status: 400 })
  }

  // Reason is optional, and only meaningful for thumbs-down. Trim and cap
  // length so a hostile payload can't bloat the row.
  let reason: string | null = null
  if (rating === 'down' && typeof body.reason === 'string') {
    const trimmed = body.reason.trim()
    if (trimmed) reason = trimmed.slice(0, 2000)
  }

  try {
    const ok = await setMatchRating({
      eventId,
      userEmail: email,
      rating,
      reason,
    })
    if (!ok) {
      // No row for this (event, user) — either a stale dashboard render
      // or someone hand-crafting requests. 404 keeps the client honest
      // and avoids firing a noisy notification.
      return NextResponse.json({ error: 'match not found' }, { status: 404 })
    }

    // Only notify on set (up / down), not on clear. No point pinging
    // Andy that someone undid a rating.
    if (rating) {
      waitUntil(
        (async () => {
          try {
            const [user, event] = await Promise.all([
              getUserByEmail(email),
              getEventById(eventId),
            ])
            if (!user || !event) return
            await sendMatchRatingNotification({
              userId: user.id,
              userName: user.name || '',
              userEmail: email,
              eventName: event.name,
              rating,
              reason,
            })
          } catch (err) {
            console.error('match-rating notification error:', err)
          }
        })(),
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/match-rating error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
