import { NextRequest, NextResponse } from 'next/server'
import { AirtableEvent, AirtableUser } from '@/lib/airtable'
import { getActiveUsers, getUserById } from '@/lib/users'
import { getFutureEvents } from '@/lib/events'
import { syncSingleEvent, syncSingleUser } from '@/lib/sync'
import { withinMiles } from '@/lib/geocode'
import {
  scoreEventUser,
  isMatchEligible,
  computeInputsHash,
  ScoreResult,
} from '@/lib/matching'
import { getExistingMatch, logMatch, markMatchesNotified } from '@/lib/supabase'
import {
  sendUserDigest,
  sendApprovedWithDigest,
  sendUserApprovedEmail,
  sendLocationUpdatedDigest,
} from '@/lib/email'
import { DIGEST_CAP_PER_SECTION } from '@/lib/digest'

export const maxDuration = 300

const SCORE_THRESHOLD = 1.0
// Align welcome digest threshold with everywhere else (dashboard, cron digest,
// each-new-event email) so the first email a new user gets contains the same
// set of matches their dashboard shows.
const DIGEST_THRESHOLD = 1.35
const BATCH_SIZE = 50
const NEARBY_RADIUS_MILES = 100

// How many future events are within 100mi of the user. Used to pick
// which inline coaching variant the no-match welcome should carry
// (variant A when 0, variant B when >=1). Returns 0 when the user has
// no geocoded location, which is the safe fallback (variant A).
function countNearbyEvents(user: AirtableUser, events: AirtableEvent[]): number {
  if (typeof user.lat !== 'number' || typeof user.lng !== 'number') return 0
  const userPoint = { lat: user.lat, lng: user.lng }
  let n = 0
  for (const e of events) {
    if (typeof e.lat !== 'number' || typeof e.lng !== 'number') continue
    if (withinMiles(userPoint, { lat: e.lat, lng: e.lng }, NEARBY_RADIUS_MILES)) n++
  }
  return n
}

async function processEventTrigger(eventId: string) {
  // Brand-new events fire this trigger before the cron sync has a chance
  // to mirror them into Supabase. Pull just this row straight from
  // Airtable so the subsequent getFutureEvents() Supabase read sees the
  // freshly-created event. Idempotent — re-runs just refresh the row.
  await syncSingleEvent(eventId)

  const events = await getFutureEvents()
  const event = events.find((e) => e.id === eventId)
  if (!event) {
    console.error(`process-matches: event ${eventId} not found (or not in future)`)
    return
  }

  const allUsers = await getActiveUsers()
  const users = allUsers.filter(isMatchEligible)
  console.log(
    `process-matches: scoring event "${event.name}" against ${users.length} eligible users (skipped ${
      allUsers.length - users.length
    } ineligible)`,
  )

  // Tally per-user outcomes so silent failures surface in logs. Without
  // this, a one-off Claude/Supabase blip for a single user is invisible.
  let scored = 0
  let cached = 0
  let failed = 0
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map((user) => scoreAndNotify(event, user, 'event')),
    )
    for (const r of results) {
      if (r === 'cached') cached++
      else if (r === 'scored') scored++
      else failed++
    }
  }
  console.log(
    `process-matches: event "${event.name}" done — scored ${scored}, cached ${cached}, failed ${failed} (of ${users.length})`,
  )
}

async function processUserTrigger(
  userId: string,
  options: { noEmail?: boolean; welcome?: boolean; locationChanged?: boolean } = {},
) {
  // Just-approved or just-edited users fire this trigger before the cron
  // sync runs. Pull this row straight from Airtable so active / interests
  // / location reflect the latest admin action.
  await syncSingleUser(userId)

  const targetUser = await getUserById(userId)
  if (!targetUser) {
    console.log(`process-matches: user ${userId} not found, skipping`)
    return
  }
  if (!targetUser.active) {
    console.log(`process-matches: user ${targetUser.email} is not active, skipping`)
    return
  }
  if (!isMatchEligible(targetUser)) {
    console.log(
      `process-matches: user ${targetUser.email} is not eligible (missing Grade/Function/Seniority), skipping`,
    )
    // A welcome trigger expects an email to land. Send the plain approval so
    // an ineligible-at-approval user still hears that they're in.
    if (options.welcome && !options.noEmail) {
      try {
        await sendUserApprovedEmail(targetUser)
      } catch (e) {
        console.error(`process-matches: fallback sendUserApprovedEmail failed for ${targetUser.email}:`, e)
      }
    }
    return
  }

  const events = await getFutureEvents()
  console.log(
    `process-matches: scoring ${events.length} future events for user "${targetUser.email}"`,
  )

  const scored: Array<{ event: AirtableEvent; outcome: ScoreOutcome }> = []

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (event) => {
        const outcome = await scoreOrReuse(event, targetUser!, 'user')
        return { event, outcome }
      }),
    )
    scored.push(...results)
  }

  // Persist freshly-computed rows. Cached rows are already up to date, skip writing.
  await Promise.all(
    scored
      .filter((s) => !s.outcome.cached)
      .map((s) =>
        logMatch({
          eventId: s.event.id,
          userId: targetUser!.id,
          userEmail: targetUser!.email,
          score: s.outcome.result.score,
          matchPercent: s.outcome.result.matchPercent,
          locationScore: s.outcome.result.location,
          audienceScore: s.outcome.result.audience,
          qualityScore: s.outcome.result.quality,
          preferenceScore: s.outcome.result.preferences,
          inputsHash: s.outcome.result.inputsHash,
          skippedReason: s.outcome.result.skippedReason,
        }),
      ),
  )

  if (options.noEmail) return
  // Paused users never receive a post-matching email. The approval
  // email was already sent up front by the airtable-user-approved webhook.
  if (targetUser.frequency === 'Paused') return

  // "New" = top 3 freshly-scored matches above threshold (haven't been
  // included in an earlier email). "Top Matches" = top 3 of ALL matches
  // above threshold (cached or fresh); may overlap with New, in which case
  // the email template renders the overlapping rows compactly.
  const allAboveThreshold = scored
    .filter((s) => s.outcome.result.score >= DIGEST_THRESHOLD)
    .sort((a, b) => b.outcome.result.score - a.outcome.result.score)
  const freshAboveThreshold = allAboveThreshold.filter((s) => !s.outcome.cached)

  const toEntry = (s: { event: AirtableEvent; outcome: ScoreOutcome }) => ({
    event: s.event,
    matchPercent: s.outcome.result.matchPercent,
  })
  const newEvents = freshAboveThreshold
    .slice(0, DIGEST_CAP_PER_SECTION)
    .map(toEntry)
  const topMatches = allAboveThreshold
    .slice(0, DIGEST_CAP_PER_SECTION)
    .map(toEntry)

  if (options.welcome) {
    // First email since approval: combined "welcome + your first matches".
    // Falls back to a plain approval email when no matches qualify so the
    // user still hears they're in.
    // For no-match cases we also pass nearbyCount so the welcome can
    // inline the appropriate coaching CTAs (variant A vs B) instead of
    // waiting for next Monday's cron.
    const nearbyCount = countNearbyEvents(targetUser, events)
    try {
      await sendApprovedWithDigest(
        targetUser,
        { newEvents, topMatches, totalUpcomingMatches: allAboveThreshold.length },
        nearbyCount,
      )
    } catch (e) {
      console.error(`process-matches: sendApprovedWithDigest failed for ${targetUser.email}, falling back to plain approval:`, e)
      try {
        await sendUserApprovedEmail(targetUser)
      } catch (e2) {
        console.error(`process-matches: fallback sendUserApprovedEmail also failed for ${targetUser.email}:`, e2)
      }
    }
    if (newEvents.length) {
      await markMatchesNotified(
        newEvents.map((e) => ({ eventId: e.event.id, userId: targetUser.id })),
      )
    }
    return
  }

  if (options.locationChanged) {
    // Self-service location update on the dashboard — send a
    // location-specific digest IFF the re-scoring surfaced new
    // matches above threshold. Silent no-op when nothing new came
    // into range (typo fix, city we don't have events near, etc.).
    if (!freshAboveThreshold.length) return
    try {
      await sendLocationUpdatedDigest(
        targetUser,
        { newEvents, topMatches, totalUpcomingMatches: allAboveThreshold.length },
        targetUser.location || '',
      )
      await markMatchesNotified(
        newEvents.map((e) => ({ eventId: e.event.id, userId: targetUser.id })),
      )
    } catch (e) {
      console.error(
        `process-matches: sendLocationUpdatedDigest failed for ${targetUser.email}:`,
        e,
      )
    }
    return
  }

  if (!freshAboveThreshold.length) return
  await sendUserDigest(targetUser, {
    newEvents,
    topMatches,
    totalUpcomingMatches: allAboveThreshold.length,
  })
  await markMatchesNotified(
    newEvents.map((e) => ({ eventId: e.event.id, userId: targetUser.id })),
  )
}

type ScoreOutcomeStatus = 'scored' | 'cached' | 'failed'

async function scoreAndNotify(
  event: AirtableEvent,
  user: AirtableUser,
  fixedSide: 'event' | 'user',
): Promise<ScoreOutcomeStatus> {
  try {
    const outcome = await scoreOrReuse(event, user, fixedSide)

    if (outcome.cached) {
      // Already persisted with the same inputs; user was already notified at this score.
      return 'cached'
    }

    const result = outcome.result
    await logMatch({
      eventId: event.id,
      userId: user.id,
      userEmail: user.email,
      score: result.score,
      matchPercent: result.matchPercent,
      locationScore: result.location,
      audienceScore: result.audience,
      qualityScore: result.quality,
      preferenceScore: result.preferences,
      inputsHash: result.inputsHash,
      skippedReason: result.skippedReason,
    })

    if (result.score < SCORE_THRESHOLD) return 'scored'

    // Frequency routes delivery — all three batched paths now flow
    // through cron, so this function's job is just to log the match:
    //   - As they arrive: daily cron (/api/cron/digest-daily) picks it up
    //   - Weekly / Monthly: Monday cron (/api/cron/digest) picks it up
    //   - Paused: never email
    // logMatch above already wrote notified_at = NULL, so no further
    // action is needed here. Caps on duplicate sends are enforced at
    // the cron level via getUnnotifiedMatchesForUser.
    return 'scored'
  } catch (err) {
    console.error(`process-matches: error for user ${user.email} / event ${event.id}:`, err)
    return 'failed'
  }
}

interface ScoreOutcome {
  cached: boolean
  result: ScoreResult
  // notified_at on the (event, user) match row BEFORE the upsert
  // re-stamps anything. Used by the 'As they arrive' delivery decision
  // — if the user was already told about this event, we don't fire a
  // fresh per-event digest just because the rescore moved their score
  // around.
  previousNotifiedAt: string | null
}

async function scoreOrReuse(
  event: AirtableEvent,
  user: AirtableUser,
  fixedSide: 'event' | 'user',
): Promise<ScoreOutcome> {
  const hash = computeInputsHash(event, user)
  const existing = await getExistingMatch(event.id, user.id)
  const previousNotifiedAt = existing?.notified_at ?? null
  if (existing && existing.inputs_hash === hash) {
    return {
      cached: true,
      previousNotifiedAt,
      result: {
        score: existing.score,
        matchPercent:
          existing.match_percent ??
          Math.max(0, Math.min(100, Math.round((existing.score / 3.0) * 100))),
        location: 0,
        audience: null,
        quality: 0,
        preferences: null,
        reason: 'cached',
        skippedReason: null,
        inputsHash: hash,
      },
    }
  }
  const result = await scoreEventUser(event, user, fixedSide)
  return { cached: false, previousNotifiedAt, result }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const trigger = searchParams.get('trigger')
  const id = searchParams.get('id')

  if (!trigger || !id) {
    return NextResponse.json({ error: 'trigger and id are required' }, { status: 400 })
  }

  try {
    const noEmail = searchParams.get('noEmail') === '1'
    const welcome = searchParams.get('welcome') === '1'
    const locationChanged = searchParams.get('locationChanged') === '1'
    if (trigger === 'event') {
      await processEventTrigger(id)
    } else if (trigger === 'user') {
      await processUserTrigger(id, { noEmail, welcome, locationChanged })
    } else {
      return NextResponse.json({ error: 'trigger must be "event" or "user"' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('process-matches error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
