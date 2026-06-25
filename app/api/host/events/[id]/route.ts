import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getSessionUser } from '@/lib/host-auth'
import { updateEvent } from '@/lib/airtable'
import { getActiveUsers } from '@/lib/users'
import { getEventByIdIfHost } from '@/lib/events'
import { getMatchesForEvent } from '@/lib/supabase'
import { notifyHostEventUpdate, type FieldChange } from '@/lib/slack'
import { EventRecord, VIRTUAL_LOCATION_RE } from '@/lib/types'

// Per-event host view + edit. Auth: caller's Airtable user id must appear in
// the event's Host linked field. updateEvent is shared with the regular submit
// flow so it handles geocoding + cache invalidation.

export const maxDuration = 60

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const event = await getEventByIdIfHost(params.id, user.id)
  if (!event) {
    // 404 covers both "no such event" and "you're not the host" — we don't
    // want to leak existence info to non-hosts.
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  try {
    const [matchRows, activeUsers] = await Promise.all([
      getMatchesForEvent(event.id),
      getActiveUsers(),
    ])

    const usersById = new Map(activeUsers.map((u) => [u.id, u]))

    const matches = []
    for (const m of matchRows) {
      const u = usersById.get(m.user_id)
      if (!u) continue
      const displayName =
        u.name && u.name !== 'DEFAULT'
          ? u.name
          : u.firstName && u.firstName !== 'DEFAULT'
            ? u.firstName
            : u.email
      matches.push({
        userId: u.id,
        name: displayName,
        linkedin: u.linkedin || '',
        function: u.function,
        seniority: u.seniority,
        interest: u.interest,
        matchPercent: m.match_percent ?? Math.round((m.score / 3.0) * 100),
        score: m.score,
        locationScore: m.location_score,
        audienceScore: m.audience_score,
        qualityScore: m.quality_score,
        preferenceScore: m.preference_score,
      })
    }

    return NextResponse.json({ event, matches })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('host/events/[id] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const user = await getSessionUser(req)
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const event = await getEventByIdIfHost(params.id, user.id)
  if (!event) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  let body: Partial<EventRecord>
  try {
    body = (await req.json()) as Partial<EventRecord>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // Whitelist the fields a host can edit. Submitter/host/link stay put — the
  // link is the de-dupe key and changing it would orphan match rows; host is
  // managed elsewhere.
  const update: Partial<EventRecord> = {}
  if (body.name !== undefined) update.name = body.name.trim()
  if (body.type !== undefined) update.type = body.type
  if (body.date !== undefined) update.date = body.date
  if (body.location !== undefined) update.location = body.location.trim()
  if (body.description !== undefined) update.description = body.description
  if (body.audience !== undefined) update.audience = body.audience

  if (update.name === '') {
    return NextResponse.json({ error: 'Event name is required' }, { status: 400 })
  }
  if (update.type === 'Virtual' || VIRTUAL_LOCATION_RE.test(update.location || '')) {
    return NextResponse.json(
      { error: 'We only accept in-person events with a specific city.' },
      { status: 400 },
    )
  }

  try {
    await updateEvent(params.id, update)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('host/events/[id] PATCH error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Internal Slack alert. Only fires for host edits — admin edits at
  // /admin/events/[id] deliberately stay silent. Build per-field {from, to}
  // diffs against the pre-edit event (already fetched for the host auth
  // gate). Skip no-op fields so quiet saves stay quiet.
  const changes: Record<string, FieldChange> = {}
  const fieldPairs: Array<[keyof EventRecord, string, string | undefined]> = [
    ['name', event.name ?? '', update.name],
    ['type', event.type ?? '', update.type],
    ['date', event.date ?? '', update.date],
    ['location', event.location ?? '', update.location],
    ['description', event.description ?? '', update.description],
    [
      'audience',
      (event.audience ?? []).join(', '),
      update.audience !== undefined ? update.audience.join(', ') : undefined,
    ],
  ]
  for (const [key, fromVal, toVal] of fieldPairs) {
    if (toVal === undefined) continue
    if (fromVal === toVal) continue
    changes[key as string] = { from: fromVal, to: toVal }
  }
  if (Object.keys(changes).length > 0) {
    waitUntil(
      notifyHostEventUpdate({
        eventId: params.id,
        eventName: event.name,
        eventLink: event.link,
        hostEmail: user.email,
        changes,
      }).catch((e) =>
        console.error('host/events/[id]: notifyHostEventUpdate failed', e),
      ),
    )
  }

  // Re-run matching against the updated event so the match list reflects new
  // targeting. waitUntil keeps the background fetch alive past the response.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.whisperedevents.com'
  waitUntil(
    fetch(`${appUrl}/api/process-matches?trigger=event&id=${params.id}`).catch((e) =>
      console.error('host/events/[id]: process-matches fire-and-forget error', e),
    ),
  )

  return NextResponse.json({ ok: true })
}
