import { NextRequest, NextResponse } from 'next/server'
import { AirtableEvent, AirtableUser } from '@/lib/airtable'
import { getActiveUsers, getUserById } from '@/lib/users'
import { getFutureEvents, getEventById } from '@/lib/events'
import { withinMiles } from '@/lib/geocode'
import {
  scoreEventUser,
  isMatchEligible,
  NEARBY_RADIUS_MILES,
  ScoreResult,
} from '@/lib/matching'
import { getExistingMatch, logMatch, markMatchesNotified, resetNotifiedAtForEvent } from '@/lib/supabase'
import {
  sendUserDigest,
  sendApprovedWithDigest,
  sendUserApprovedEmail,
  sendLocationUpdatedDigest,
} from '@/lib/email'
import { DIGEST_CAP_PER_SECTION } from '@/lib/digest'

export const maxDuration = 300

// Align welcome digest threshold with everywhere else (dashboard, cron digest,
// each-new-event email) so the first email a new user gets contains the same
// set of matches their dashboard shows.
const DIGEST_THRESHOLD = 1.35
// Conservative concurrency. Anthropic Haiku is ~50 RPM on our tier;
// fanning out 50 calls per batch invites 429s. 8-at-a-time keeps a
// per-user rescore (~40 events) well inside the rate limit even when
// other jobs (cron, event triggers) overlap, with callWithRetry
// covering any leftover transient throttling.
const BATCH_SIZE = 8

// How many future events are within range of the user. Used to pick
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
  // Use getEventById so Pending events (not yet Live) can be pre-scored for
  // admin preview. getFutureEvents() filters status='Live' and would miss them.
  const event = await getEventById(eventId)
  if (!event) {
    console.error(`process-matches: event ${eventId} not found`)
    return
  }

  const isLive = event.status === 'Live'

  // When an event goes Live, reset any pre-stamped notified_at values from
  // Pending-preview scoring so those rows become cron-eligible again.
  if (isLive) {
    try {
      await resetNotifiedAtForEvent(eventId)
    } catch (e) {
      console.error(`process-matches: resetNotifiedAtForEvent failed for ${eventId}:`, e)
    }
  }

  const allUsers = await getActiveUsers()
  const users = allUsers.filter(isMatchEligible)
  console.log(
    `process-matches: scoring event "${event.name}" (${event.status}) against ${users.length} eligible users (skipped ${
      allUsers.length - users.length
    } ineligible)`,
  )

  // Tally per-user outcomes so silent failures surface in logs. Without
  // this, a one-off Claude/Supabase blip for a single user is invisible.
  let scored = 0
  let failed = 0
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map((user) => scoreAndNotify(event, user, 'event', { preNotify: !isLive })),
    )
    for (const r of results) {
      if (r === 'scored') scored++
      else failed++
    }
  }
  console.log(
    `process-matches: event "${event.name}" done — scored ${scored}, failed ${failed} (of ${users.length})`,
  )
}

async function processUserTrigger(
  userId: string,
  options: { noEmail?: boolean; welcome?: boolean; locationChanged?: boolean } = {},
) {
  // Users are Supabase-canonical — getUserById reads the latest admin save
  // directly. No pre-fetch from Airtable needed.
  const targetUser = await getUserById(userId)
  if (!targetUser) {
    console.log(`process-matches: user ${userId} not found, skipping`)
    return
  }
  if (!targetUser.active && !options.noEmail) {
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
  let failedCount = 0

  // Per-event try/catch isolates failures: a single 429 or timeout
  // shouldn't nuke the entire user's rescore. Failed events log + skip;
  // every successful event is written. Without this isolation a single
  // bad LLM call would reject the whole Promise.all and the user would
  // see "nothing happened" after a long Refresh.
  // Score AND write each event within the same task so the matches
  // table updates incrementally as the run progresses. The dashboard's
  // rescore-status polling endpoint reads the matches table and reports
  // "N of total done" — splitting score-then-write into two phases hid
  // all progress until the final flush, which read as a frozen spinner.
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (event) => {
        try {
          const outcome = await scoreFresh(event, targetUser!, 'user')
          try {
            await logMatch({
              eventId: event.id,
              userId: targetUser!.id,
              userEmail: targetUser!.email,
              score: outcome.result.score,
              matchPercent: outcome.result.matchPercent,
              locationScore: outcome.result.location,
              audienceScore: outcome.result.audience,
              qualityScore: outcome.result.quality,
              preferenceScore: outcome.result.preferences,
              inputsHash: outcome.result.inputsHash,
              skippedReason: outcome.result.skippedReason,
            })
          } catch (err) {
            console.error(
              `process-matches: logMatch failed for user ${targetUser!.email} / event ${event.id}:`,
              err,
            )
          }
          return { event, outcome }
        } catch (err) {
          console.error(
            `process-matches: scoreFresh failed for user ${targetUser!.email} / event ${event.id}:`,
            err,
          )
          failedCount++
          return null
        }
      }),
    )
    for (const r of results) if (r) scored.push(r)
  }

  console.log(
    `process-matches: user "${targetUser.email}" done — scored ${scored.length}, failed ${failedCount} (of ${events.length})`,
  )

  if (options.noEmail) return
  // Paused users skip ongoing post-matching emails (location-change digests,
  // event-trigger blasts), but they DO receive the one-time welcome — same
  // shape as non-paused (matches if any, coaching variant if none). The
  // welcome path is the only event-driven email Paused users ever get;
  // ongoing match delivery is gated by their frequency preference downstream.
  if (!options.welcome && targetUser.frequency === 'Paused') return

  // "New" = top 3 freshly-scored matches above threshold that the user
  // hasn't been told about yet (previousNotifiedAt is null). "Top Matches"
  // = top 3 of all matches above threshold this run.
  const allAboveThreshold = scored
    .filter((s) => s.outcome.result.score >= DIGEST_THRESHOLD)
    .sort((a, b) => b.outcome.result.score - a.outcome.result.score)
  const freshAboveThreshold = allAboveThreshold.filter(
    (s) => s.outcome.previousNotifiedAt === null,
  )

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

type ScoreOutcomeStatus = 'scored' | 'failed'

async function scoreAndNotify(
  event: AirtableEvent,
  user: AirtableUser,
  fixedSide: 'event' | 'user',
  opts: { preNotify?: boolean } = {},
): Promise<ScoreOutcomeStatus> {
  try {
    const outcome = await scoreFresh(event, user, fixedSide)

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
    }, { preNotify: opts.preNotify })

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
  result: ScoreResult
  // notified_at on the (event, user) match row BEFORE the upsert
  // re-stamps anything. Used by the 'As they arrive' delivery decision
  // — if the user was already told about this event, we don't fire a
  // fresh per-event digest just because the rescore moved their score
  // around.
  previousNotifiedAt: string | null
}

// Every trigger of process-matches re-runs the AI from scratch.
// Triggers are rare and user-initiated (admin Refresh, a profile save,
// event create/edit, status flip) — they're the moments where the
// admin actively wants the latest rules applied. Skipping the AI here
// is what caused Michelle's CMO score to stay stale: the inputs hash
// matched her old cached row, the code thought "no work to do," and
// her new audience-floor boost never landed.
//
// The bulk /api/admin/rescore-missing button still uses inputs_hash
// to skip pairs that haven't changed — that's where the optimization
// actually matters (thousands of pairs, slow LLM calls).
async function scoreFresh(
  event: AirtableEvent,
  user: AirtableUser,
  fixedSide: 'event' | 'user',
): Promise<ScoreOutcome> {
  const existing = await getExistingMatch(event.id, user.id)
  const previousNotifiedAt = existing?.notified_at ?? null
  const result = await scoreEventUser(event, user, fixedSide)
  return { previousNotifiedAt, result }
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
