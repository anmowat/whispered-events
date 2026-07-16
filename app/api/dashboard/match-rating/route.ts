import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import {
  verifySession,
  setMatchRating,
  getRatingCountByUserId,
  MatchRating,
} from '@/lib/supabase'
import { getUserByEmail } from '@/lib/users'
import { getEventById } from '@/lib/events'
import { sendMatchRatingNotification } from '@/lib/email'

// Phase 2 (live): modal fires only when the user's total up-count lands
// on one of the ANNIVERSARY_MILESTONES below. Flip back to true to
// re-enable the every-click testing behaviour from Phase 1.
const SHOW_GROW_MODAL_ALWAYS = false
const ANNIVERSARY_MILESTONES = [1, 10, 25, 50]

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

  const session = await verifySession(sessionToken)
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const email = session.email

  const body = (await req.json()) as {
    eventId?: unknown
    rating?: unknown
    reason?: unknown
  }

  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
  if (!eventId) {
    return NextResponse.json({ error: 'eventId required' }, { status: 400 })
  }

  // null = clear. We accept 'interested' / 'skip' / 'not_a_fit' / null.
  let rating: MatchRating | null
  if (body.rating === null) {
    rating = null
  } else if (body.rating === 'interested' || body.rating === 'skip' || body.rating === 'not_a_fit') {
    rating = body.rating
  } else {
    return NextResponse.json({ error: 'invalid rating' }, { status: 400 })
  }

  // Reason is optional, and only meaningful for not_a_fit. Trim and cap
  // length so a hostile payload can't bloat the row.
  let reason: string | null = null
  if (rating === 'not_a_fit' && typeof body.reason === 'string') {
    const trimmed = body.reason.trim()
    if (trimmed) reason = trimmed.slice(0, 2000)
  }

  try {
    const ok = await setMatchRating({
      eventId,
      userId: session.userId,
      rating,
      reason,
    })
    if (!ok) {
      console.error('match-rating: no row found', { userId: session.userId, eventId, rating })
      return NextResponse.json({ error: 'match not found' }, { status: 404 })
    }

    // Only notify on set, not on clear. No point pinging
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
              userLinkedin: user.linkedin || null,
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

    // Decide whether to surface the dashboard's "thanks, help us grow"
    // modal. Only fires on toggle-on of 'interested'; a clear leaves the user's
    // UX untouched. Count is read AFTER the save so milestones tier off
    // the rating they just gave.
    let showGrowModal = false
    if (rating === 'interested') {
      if (SHOW_GROW_MODAL_ALWAYS) {
        showGrowModal = true
      } else {
        try {
          const counts = await getRatingCountByUserId(session.userId)
          if (ANNIVERSARY_MILESTONES.includes(counts.interested)) showGrowModal = true
        } catch (err) {
          console.error('match-rating: getRatingCountByUserId failed', err)
        }
      }
    }

    return NextResponse.json({ ok: true, showGrowModal })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('dashboard/match-rating error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
