import { NextRequest, NextResponse } from 'next/server'
import { getAllMatchesForUser } from '@/lib/supabase'
import { getFutureEvents, getUserByEmail } from '@/lib/airtable'
import { isMatchEligible } from '@/lib/matching'

// Admin: returns every persisted match row for a given user with the full
// score breakdown, joined with the event name. Helps debug "why am I not
// seeing events on the dashboard?". Auth via shared webhook secret.

function normalize(v: string | null | undefined): string {
  if (!v) return ''
  let s = v.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s
}

export async function GET(req: NextRequest) {
  const got = normalize(req.headers.get('x-webhook-secret'))
  const expected = normalize(process.env.AIRTABLE_WEBHOOK_SECRET)
  if (!expected || got !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const email = req.nextUrl.searchParams.get('email')
  if (!email) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 })
  }

  const [matches, events, user] = await Promise.all([
    getAllMatchesForUser(email.toLowerCase().trim()),
    getFutureEvents(),
    getUserByEmail(email.toLowerCase().trim()),
  ])
  const eventById = new Map(events.map((e) => [e.id, e]))

  const userBlock = user
    ? {
        id: user.id,
        email: user.email,
        active: user.active,
        status: user.status,
        grade: user.grade ?? null,
        function: user.function || null,
        seniority: user.seniority || null,
        location: user.location || null,
        latLon: user.lat != null && user.lng != null ? `${user.lat},${user.lng}` : null,
        eligibleForMatching: isMatchEligible(user),
      }
    : { found: false }

  const rows = matches.map((m) => {
    const event = eventById.get(m.event_id)
    return {
      eventId: m.event_id,
      eventName: event?.name ?? '(not in future events)',
      eventDate: event?.date ?? null,
      eventLocation: event?.location ?? null,
      score: m.score,
      matchPercent: m.match_percent,
      location: m.location_score,
      audience: m.audience_score,
      quality: m.quality_score,
      preferences: m.preference_score,
      skippedReason: m.skipped_reason,
    }
  })

  const summary = {
    total: rows.length,
    aboveThreshold: rows.filter((r) => r.score >= 1.0).length,
    skippedLocation: rows.filter((r) => r.skippedReason === 'location_zero').length,
    skippedGradeC: rows.filter((r) => r.skippedReason === 'grade_c').length,
    inFutureEvents: rows.filter((r) => r.eventName !== '(not in future events)').length,
    futureEventsTotal: events.length,
    futureEventsWithLatLon: events.filter((e) => e.lat != null && e.lng != null).length,
  }

  return NextResponse.json({ email, user: userBlock, summary, rows })
}
