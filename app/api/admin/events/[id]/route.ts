import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { isAdmin } from '@/lib/admin-auth'
import { getActiveUsers, getUsersByIds, getUserByEmail } from '@/lib/users'
import { getEventById, getEventFlags } from '@/lib/events'
import { getAllMatchesForEvent } from '@/lib/supabase'
import { withinMiles } from '@/lib/geocode'
import { NEARBY_RADIUS_MILES } from '@/lib/matching'
import { updateEvent } from '@/lib/airtable'
import { sendHostAddedEmail } from '@/lib/email'

// Admin event detail: returns the event + every active user within
// range, each row paired with their match score (and breakdown) if
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

    // image_url, featured, and host_ids aren't part of AirtableEvent (the
    // public read shape), so fetch them via lib/events.ts:getEventFlags
    // for the admin image management UI, the Featured toggle, and the
    // hosts list.
    const [allUsers, matchRows, flags] = await Promise.all([
      getActiveUsers(),
      getAllMatchesForEvent(eventId),
      getEventFlags(eventId),
    ])
    const imageUrl = flags?.image_url ?? ''
    const featured = flags?.featured ?? false
    const hostIds = flags?.host_ids ?? []
    const status = flags?.status ?? 'Pending'
    const submitterEmail = flags?.submitter_email ?? ''
    const hostUsers = await getUsersByIds(hostIds)
    const hosts = hostUsers.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      firstName: u.firstName,
    }))

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
        imageUrl,
        featured,
        hosts,
        status,
        submitterEmail,
        inviteEmployment: event.inviteEmployment ?? [],
        inviteCompanySize: event.inviteCompanySize ?? [],
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

// Admin event edits go through here in a single PATCH so updateEvent fires
// once per save. Same isAdmin gate as the GET; the write fans through
// lib/airtable.ts:updateEvent (Supabase canonical + best-effort Airtable
// follower push).
const VALID_TYPES = new Set(['Conference', 'Dinner', 'Virtual', 'Other'])
const VALID_EVENT_STATUSES = new Set(['Pending', 'Live', 'Deactivated'])

export async function PATCH(
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
    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown
      type?: unknown
      date?: unknown
      location?: unknown
      link?: unknown
      audience?: unknown
      description?: unknown
      featured?: unknown
      hostEmails?: unknown
      status?: unknown
      inviteEmployment?: unknown
      inviteCompanySize?: unknown
    }

    const update: Parameters<typeof updateEvent>[1] = {}
    if (typeof body.name === 'string') update.name = body.name.trim()
    if (typeof body.type === 'string' && VALID_TYPES.has(body.type)) {
      update.type = body.type as 'Conference' | 'Dinner' | 'Virtual' | 'Other'
    }
    if (typeof body.date === 'string') update.date = body.date
    if (typeof body.location === 'string') update.location = body.location.trim()
    if (typeof body.link === 'string') update.link = body.link.trim()
    if (typeof body.description === 'string') update.description = body.description
    if (Array.isArray(body.audience)) {
      update.audience = body.audience
        .filter((a): a is string => typeof a === 'string')
        .map((a) => a.trim())
        .filter(Boolean)
    }
    if (typeof body.featured === 'boolean') update.featured = body.featured
    if (typeof body.status === 'string' && VALID_EVENT_STATUSES.has(body.status)) {
      update.status = body.status as 'Pending' | 'Live' | 'Deactivated'
    }
    if (Array.isArray(body.inviteEmployment)) {
      update.inviteEmployment = body.inviteEmployment.filter((s): s is string => typeof s === 'string')
    }
    if (Array.isArray(body.inviteCompanySize)) {
      update.inviteCompanySize = body.inviteCompanySize.filter((s): s is string => typeof s === 'string')
    }

    // hostEmails is the canonical edit surface for the host list. Resolve
    // each email to a user id; any unresolved email blocks the save with
    // a clear error so the admin can fix the typo.
    let hostIds: string[] | undefined
    let resolvedHostUsers: Array<{ id: string; email: string; firstName: string; name: string }> = []
    if (Array.isArray(body.hostEmails)) {
      const emails = body.hostEmails
        .filter((e): e is string => typeof e === 'string')
        .map((e) => e.trim())
        .filter(Boolean)
      const missing: string[] = []
      for (const email of emails) {
        const u = await getUserByEmail(email)
        if (u) resolvedHostUsers.push({ id: u.id, email: u.email, firstName: u.firstName, name: u.name })
        else missing.push(email)
      }
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `no user found for: ${missing.join(', ')}` },
          { status: 400 },
        )
      }
      hostIds = Array.from(new Set(resolvedHostUsers.map((u) => u.id)))
    }

    if (Object.keys(update).length === 0 && hostIds === undefined) {
      return NextResponse.json(
        { error: 'no editable fields in request body' },
        { status: 400 },
      )
    }
    // Snapshot prior state before the write so we can detect transitions.
    // Fetched when status or hosts are changing; combined into one read.
    let priorStatus: string | null = null
    let priorHostIds: string[] = []
    if (update.status !== undefined || hostIds !== undefined) {
      const priorFlags = await getEventFlags(eventId)
      priorStatus = priorFlags?.status ?? null
      priorHostIds = priorFlags?.host_ids ?? []
    }

    await updateEvent(eventId, update, hostIds)
    const updated = Object.keys(update)
    if (hostIds !== undefined) updated.push('hostIds')

    // Send host-added emails to newly-assigned hosts (those not already in
    // the prior host list). Fire-and-forget via waitUntil so the admin
    // save response isn't blocked by email delivery.
    if (hostIds !== undefined && resolvedHostUsers.length > 0) {
      const priorSet = new Set(priorHostIds)
      const newHosts = resolvedHostUsers.filter((u) => !priorSet.has(u.id))
      if (newHosts.length > 0) {
        const eventForEmail = await getEventById(eventId)
        const eventName = eventForEmail?.name ?? ''
        for (const host of newHosts) {
          const firstName = (host.firstName && host.firstName !== 'DEFAULT')
            ? host.firstName
            : (host.name && host.name !== 'DEFAULT')
              ? host.name.split(' ')[0]
              : ''
          waitUntil(
            sendHostAddedEmail({ hostEmail: host.email, hostFirstName: firstName, eventName, eventId })
              .catch((e) => console.error('sendHostAddedEmail failed', { email: host.email, error: e })),
          )
        }
      }
    }

    // Pending/Deactivated -> Live transition: score this event against
    // every eligible user so matches are populated by the time users
    // refresh their dashboards. waitUntil keeps the admin save fast.
    if (update.status === 'Live' && priorStatus !== 'Live') {
      const appUrl = new URL(req.url).origin
      waitUntil(
        fetch(`${appUrl}/api/process-matches?trigger=event&id=${eventId}`).catch(
          (e) => console.error('admin/events/[id] PATCH: trigger event match failed', e),
        ),
      )
    }

    return NextResponse.json({ ok: true, updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/events/[id] PATCH error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
