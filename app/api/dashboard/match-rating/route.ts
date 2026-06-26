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

// Phase 1 (test): true — fire the "thanks, help us grow" modal on every
// successful 👍 toggle-on so the team can sanity-check copy and links.
// Phase 2 (live): flip to false — modal fires only when the user's total
// up-count lands on one of the ANNIVERSARY_MILESTONES below.
// Keep this as a code constant so the Phase 1 → Phase 2 transition shows
// up in a commit rather than hiding in Vercel env settings.
const SHOW_GROW_MODAL_ALWAYS = true
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
      userId: session.userId,
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

    // Decide whether to surface the dashboard's "thanks, help us grow"
    // modal. Only fires on toggle-on of a 👍 (rating === 'up'); a 👎 or
    // a clear (rating === null) leaves the user's UX untouched. Count
    // is read AFTER the save so milestones tier off the rating they
    // just gave (the 10th up-vote actually includes the row we wrote).
    let showGrowModal = false
    if (rating === 'up') {
      if (SHOW_GROW_MODAL_ALWAYS) {
        showGrowModal = true
      } else {
        try {
          const counts = await getRatingCountByUserId(session.userId)
          if (ANNIVERSARY_MILESTONES.includes(counts.up)) showGrowModal = true
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
