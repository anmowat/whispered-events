import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getSessionUser } from '@/lib/host-auth'
import { getEventByIdIfHost, getEventById } from '@/lib/events'
import { setHostMatchRating } from '@/lib/supabase'
import { getUserById } from '@/lib/users'
import { sendHostMatchRatingNotification } from '@/lib/email'

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!sessionUser.active) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: { eventId?: unknown; userId?: unknown; rating?: unknown; feedback?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const eventId = typeof body.eventId === 'string' ? body.eventId : null
  const userId = typeof body.userId === 'string' ? body.userId : null
  const rating = body.rating === 'up' || body.rating === 'down' || body.rating === null
    ? (body.rating as 'up' | 'down' | null)
    : undefined

  if (!eventId || !userId || rating === undefined) {
    return NextResponse.json({ error: 'eventId, userId, and rating required' }, { status: 400 })
  }

  const event = await getEventByIdIfHost(eventId, sessionUser.id)
  if (!event) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const rawFeedback = typeof body.feedback === 'string' ? body.feedback.slice(0, 500) : null
  const feedback = rating === 'down' ? rawFeedback : null

  const found = await setHostMatchRating({ eventId, userId, rating, feedback })
  if (!found) {
    return NextResponse.json({ error: 'match not found' }, { status: 404 })
  }

  if (rating !== null) {
    const [guestUser, eventRecord] = await Promise.all([
      getUserById(userId),
      getEventById(eventId),
    ])
    waitUntil(
      sendHostMatchRatingNotification({
        hostId: sessionUser.id,
        hostName: sessionUser.name || sessionUser.email,
        hostEmail: sessionUser.email,
        hostLinkedin: sessionUser.linkedin || null,
        guestName: guestUser?.name || guestUser?.email || userId,
        guestUserId: userId,
        guestEmail: guestUser?.email || null,
        guestLinkedin: guestUser?.linkedin || null,
        eventName: eventRecord?.name || eventId,
        eventId,
        rating,
        feedback,
      }).catch((e) => console.error('sendHostMatchRatingNotification failed', e)),
    )
  }

  return NextResponse.json({ ok: true })
}
