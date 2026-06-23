import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { isAdmin } from '@/lib/admin-auth'
import { getUserById } from '@/lib/users'
import { getFutureEvents } from '@/lib/events'
import { getAllMatchesForUser, getContributionStats, getLastSeenForEmail, getLastEmailSentForEmail } from '@/lib/supabase'
import { updateUserAdmin, type UserAdminUpdate } from '@/lib/airtable'
import { triggerUserApprovedFlow } from '@/lib/user-approval'
import { withinMiles } from '@/lib/geocode'
import { SENIORITY_OPTIONS } from '@/lib/seniority'

const NEARBY_RADIUS_MILES = 100

// Admin user detail: returns the user's profile fields plus every future
// event scored against them, sorted by match % desc, with per-pair score
// breakdown for tooltip display.

export const maxDuration = 60

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const userId = params.id
  if (!userId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  try {
    const user = await getUserById(userId)
    if (!user) {
      return NextResponse.json({ error: 'user not found' }, { status: 404 })
    }

    const [futureEvents, matchRows, contributions, lastSeen, lastEmailSent] = await Promise.all([
      getFutureEvents(),
      getAllMatchesForUser(user.email),
      getContributionStats(user.email),
      getLastSeenForEmail(user.email),
      getLastEmailSentForEmail(user.email),
    ])

    const byEventId = new Map(matchRows.map((m) => [m.event_id, m]))

    // Restrict to events within 100mi of the user. Out-of-range events drop
    // off the list entirely so admin sees only events the user could
    // realistically attend. Events missing lat/lng or users missing lat/lng
    // are excluded too — both signal a geocoding issue that needs fixing on
    // the source row before the match makes sense.
    const userPoint =
      typeof user.lat === 'number' && typeof user.lng === 'number'
        ? { lat: user.lat, lng: user.lng }
        : null
    const inRange = userPoint
      ? futureEvents.filter(
          (e) =>
            typeof e.lat === 'number' &&
            typeof e.lng === 'number' &&
            withinMiles(userPoint, { lat: e.lat, lng: e.lng }, NEARBY_RADIUS_MILES),
        )
      : []

    // Build one row per in-range event. Events with no match row get null
    // scores and fall to the bottom of the sort (treated as 0%).
    const events = inRange
      .map((e) => {
        const m = byEventId.get(e.id)
        return {
          id: e.id,
          name: e.name,
          type: e.type,
          date: e.date,
          location: e.location,
          audience: e.audience,
          link: e.link,
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
        // Scored events first (sorted by match% desc), unscored at the bottom.
        const ap = a.matchPercent
        const bp = b.matchPercent
        if (ap === null && bp === null) return a.date.localeCompare(b.date)
        if (ap === null) return 1
        if (bp === null) return -1
        if (bp !== ap) return bp - ap
        return a.date.localeCompare(b.date)
      })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        function: user.function,
        seniority: user.seniority,
        linkedin: user.linkedin,
        grade: user.grade ?? '',
        interest: user.interest,
        learn: user.learn,
        employment: user.employment,
        companySize: user.companySize,
        location: user.location,
        lat: user.lat ?? null,
        lng: user.lng ?? null,
        active: user.active,
        status: user.status,
        frequency: user.frequency,
        // Contribution stats now sourced from Supabase `contributions` table.
        lastContribution: contributions.lastAt,
        totalContributions: contributions.total,
        contributionsLast30: contributions.last30,
        contributionsLast90: contributions.last90,
        lastSeen,
        lastEmailSent,
      },
      events,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/users/[id] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Batched user edits go through here. Same gate as GET; routes the write
// through lib/airtable.ts:updateUserAdmin so the mirror-back to Supabase
// fires once per save (and the match scorer reruns once, not per field).
const VALID_GRADES = new Set(['A', 'Polish', 'B', 'C', ''])
const VALID_STATUSES = new Set(['Pending', 'Live', 'Passed', 'Deactivated', 'Partner'])
// Empty string allowed so admin can clear a legacy non-canonical value
// (e.g. "Senior") that pre-dated the picklist.
const VALID_SENIORITIES = new Set<string>([...SENIORITY_OPTIONS, ''])

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const userId = params.id
  if (!userId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const update: UserAdminUpdate = {}

    if (typeof body.name === 'string') update.name = body.name
    if (typeof body.firstName === 'string') update.firstName = body.firstName
    if (typeof body.function === 'string') update.function = body.function
    if (typeof body.seniority === 'string' && VALID_SENIORITIES.has(body.seniority)) {
      update.seniority = body.seniority
    }
    if (typeof body.grade === 'string' && VALID_GRADES.has(body.grade)) {
      update.grade = body.grade as UserAdminUpdate['grade']
    }
    if (typeof body.location === 'string') update.location = body.location
    if (typeof body.interest === 'string') update.interest = body.interest
    if (typeof body.employment === 'string') update.employment = body.employment
    if (typeof body.companySize === 'string') update.companySize = body.companySize
    if (typeof body.frequency === 'string') update.frequency = body.frequency
    if (typeof body.linkedin === 'string') update.linkedin = body.linkedin
    if (typeof body.learn === 'string') update.learn = body.learn
    // Status replaces the old active boolean. Validate against the enum so a
    // typo doesn't write a junk value to Airtable's Status field.
    if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
      update.status = body.status as UserAdminUpdate['status']
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'no editable fields in request body' },
        { status: 400 },
      )
    }

    // Snapshot prior status before the write so we can detect a transition
    // into Live and fire the approval flow (welcome email + match seed).
    // Only fetched when status is part of the patch — saves an extra read
    // on field-only edits.
    let priorStatus: string | null = null
    if (update.status !== undefined) {
      const prior = await getUserById(userId)
      priorStatus = prior?.status ?? null
    }

    await updateUserAdmin(userId, update)

    // Pending -> Live transition was historically driven by the Airtable
    // "User Approved" automation. Now that Users live in Supabase, fire the
    // same flow here so approving someone in /admin still ships the welcome
    // email + first matches.
    if (
      update.status === 'Live' &&
      priorStatus !== 'Live' &&
      priorStatus !== 'Partner'
    ) {
      const appUrl = new URL(req.url).origin
      waitUntil(
        (async () => {
          const fresh = await getUserById(userId)
          if (fresh) await triggerUserApprovedFlow(fresh, { appUrl })
        })().catch((e) =>
          console.error('admin/users/[id] triggerUserApprovedFlow failed', e),
        ),
      )
    }

    return NextResponse.json({ ok: true, updated: Object.keys(update) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/users/[id] PATCH error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
