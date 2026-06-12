import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { getActiveUsers, getEventById } from '@/lib/airtable'
import { getAllMatchesForEvent } from '@/lib/supabase'
import { withinMiles } from '@/lib/geocode'

const NEARBY_RADIUS_MILES = 100

// Admin event detail: returns the event + every active user within
// 100mi, each row paired with their match score (and breakdown) if
// scored. Unscored users get null scores; skipped users carry their
// skip reason. Lets us drill in to "who's the marketing VP in SF who
// didn't match this event, and why."

export const maxDuration = 60

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const eventId = params.id
  if (!eventId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  try {
    const event = await getEventById(eventId)
    if (!event) {
      return NextResponse.json({ error: 'event not found' }, { status: 404 })
    }

    const [allUsers, matchRows] = await Promise.all([
      getActiveUsers(),
      getAllMatchesForEvent(eventId),
    ])

    const matchByUserId = new Map(matchRows.map((m) => [m.user_id, m]))

    // Only include users in geo range (or all users if the event is
    // missing a geocode — surfaces the bug rather than hiding it).
    const usersInRange = allUsers.filter((u) => {
      if (typeof u.lat !== 'number' || typeof u.lng !== 'number') return false
      if (typeof event.lat !== 'number' || typeof event.lng !== 'number') {
        // Event missing geocode — include everyone so the page surfaces
        // why nothing matches.
        return true
      }
      return withinMiles(
        { lat: u.lat, lng: u.lng },
        { lat: event.lat, lng: event.lng },
        NEARBY_RADIUS_MILES,
      )
    })

    // Build one row per in-range user, joined with their match scores
    // (or nulls if not scored).
    const users = usersInRange
      .map((u) => {
        const m = matchByUserId.get(u.id)
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          firstName: u.firstName,
          function: u.function,
          seniority: u.seniority,
          grade: u.grade ?? '',
          location: u.location,
          interest: u.interest,
          score: m?.score ?? null,
          matchPercent: m?.match_percent ?? null,
          locationScore: m?.location_score ?? null,
          audienceScore: m?.audience_score ?? null,
          qualityScore: m?.quality_score ?? null,
          preferenceScore: m?.preference_score ?? null,
          skippedReason: m?.skipped_reason ?? null,
        }
      })
      .sort((a, b) => {
        // Scored users first (sorted by match% desc), unscored last.
        const ap = a.matchPercent
        const bp = b.matchPercent
        if (ap === null && bp === null) {
          return (a.name || a.email).toLowerCase().localeCompare(
            (b.name || b.email).toLowerCase(),
          )
        }
        if (ap === null) return 1
        if (bp === null) return -1
        return bp - ap
      })

    return NextResponse.json({
      event: {
        id: event.id,
        name: event.name,
        type: event.type,
        date: event.date,
        location: event.location,
        description: event.description,
        link: event.link,
        audience: event.audience,
        lat: event.lat ?? null,
        lng: event.lng ?? null,
      },
      users,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/events/[id] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
