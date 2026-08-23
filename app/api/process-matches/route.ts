import { NextRequest, NextResponse } from 'next/server'
import { isInternalOrAdmin } from '@/lib/internal-auth'
import { AirtableEvent, AirtableUser } from '@/lib/airtable'
import { getActiveUsers, getUserById } from '@/lib/users'
import { getFutureEvents, getEventById } from '@/lib/events'
import { withinMiles } from '@/lib/geocode'
import {
  scoreEventUser,
  isMatchEligible,
  computeInputsHash,
  NEARBY_RADIUS_MILES,
  ScoreResult,
} from '@/lib/matching'
import {
  CachedMatchRow,
  getExistingMatch,
  getExistingMatchesForEvent,
  getExistingMatchesForUser,
  logMatch,
  markMatchesNotified,
  resetNotifiedAtForEvent,
} from '@/lib/supabase'
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
// Concurrency for user-trigger (scores N events for 1 user): keep at 8
// to avoid 429s when other jobs overlap on the same Haiku tier.
// Event-trigger (scores 1 event for N users) uses a higher batch size
// since it's one LLM call per user and we pre-fetch DB state in bulk.
const BATCH_SIZE = 8
const EVENT_TRIGGER_BATCH_SIZE = 20

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

async function processEventTrigger(eventId: string, force = false, resetNotified = false) {
  // Use getEventById so Pending events (not yet Live) can be pre-scored for
  // admin preview. getFutureEvents() filters status='Live' and would miss them.
  const event = await getEventById(eventId)
  if (!event) {
    console.error(`process-matches: event ${eventId} not found`)
    return
  }

  const isLive = event.status === 'Live'

  // Clear the notified_at values stamped during Pending-preview scoring so
  // those rows become cron-eligible once the event is Live.
  //
  // Only on the actual transition into Live — hence the explicit flag. This
  // used to fire on every event trigger against a Live event, which meant a
  // host fixing a typo on their own event reset notified_at for every matched
  // user and re-sent them an event they'd already been emailed.
  if (isLive && resetNotified) {
    try {
      await resetNotifiedAtForEvent(eventId)
    } catch (e) {
      console.error(`process-matches: resetNotifiedAtForEvent failed for ${eventId}:`, e)
    }
  }

  const [allUsers, existingMatchMap] = await Promise.all([
    getActiveUsers(),
    getExistingMatchesForEvent(eventId),
  ])
  const users = allUsers.filter(isMatchEligible)
  console.log(
    `process-matches: scoring event "${event.name}" (${event.status}) against ${users.length} eligible users (skipped ${
      allUsers.length - users.length
    } ineligible)`,
  )

  // Tally per-user outcomes so silent failures surface in logs. Without
  // this, a one-off Claude/Supabase blip for a single user is invisible.
  let scored = 0
  let cached = 0
  let failed = 0
  for (let i = 0; i < users.length; i += EVENT_TRIGGER_BATCH_SIZE) {
    const batch = users.slice(i, i + EVENT_TRIGGER_BATCH_SIZE)
    const results = await Promise.all(
      batch.map((user) => scoreAndNotify(event, user, 'event', {
        preNotify: !isLive,
        existingMatch: existingMatchMap.get(user.id) ?? null,
        force,
      })),
    )
    for (const r of results) {
      if (r === 'scored') scored++
      else if (r === 'cached') cached++
      else failed++
    }
  }
  console.log(
    `process-matches: event "${event.name}" done — scored ${scored}, cached ${cached}, failed ${failed} (of ${users.length})`,
  )
}

interface TriggerResult { sent: boolean; reason: string }

async function processUserTrigger(
  userId: string,
  options: {
    noEmail?: boolean
    welcome?: boolean
    locationChanged?: boolean
    force?: boolean
    resend?: boolean
  } = {},
): Promise<TriggerResult> {
  const force = options.force ?? false
  // Users are Supabase-canonical — getUserById reads the latest admin save
  // directly. No pre-fetch from Airtable needed.
  const targetUser = await getUserById(userId)
  if (!targetUser) {
    console.log(`process-matches: user ${userId} not found, skipping`)
    return { sent: false, reason: 'user not found' }
  }
  if (!targetUser.active && !options.noEmail) {
    console.log(`process-matches: user ${targetUser.email} is not active, skipping`)
    return { sent: false, reason: 'user is not active' }
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
    return {
      sent: !!(options.welcome && !options.noEmail),
      reason: 'not match-eligible (missing Grade/Function/Seniority)',
    }
  }

  // Prefetch every prior score for this user in one query. Previously this
  // path did a getExistingMatch round-trip per event; now the map covers all
  // of them and also supplies the cached scores for unchanged pairs.
  const [events, existingMatchMap] = await Promise.all([
    getFutureEvents(),
    getExistingMatchesForUser(targetUser.id),
  ])
  console.log(
    `process-matches: scoring ${events.length} future events for user "${targetUser.email}"`,
  )

  const scored: Array<{ event: AirtableEvent; outcome: ScoreOutcome }> = []
  let failedCount = 0
  let cachedCount = 0

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
          const outcome = await scoreFresh(
            event,
            targetUser!,
            'user',
            existingMatchMap.get(event.id) ?? null,
            force,
          )
          // Cache hit: the stored row already holds these exact values, so
          // the write would be a no-op. The pair still joins `scored` below
          // so it participates in the digest's top-matches selection.
          if (outcome.cached) {
            cachedCount++
            return { event, outcome }
          }
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
    `process-matches: user "${targetUser.email}" done — scored ${scored.length - cachedCount} fresh, ${cachedCount} cached, failed ${failedCount} (of ${events.length})`,
  )

  if (options.noEmail) return { sent: false, reason: 'noEmail was set — scoring only' }
  // Paused users skip ongoing post-matching emails (location-change digests,
  // event-trigger blasts), but they DO receive the one-time welcome — same
  // shape as non-paused (matches if any, coaching variant if none). The
  // welcome path is the only event-driven email Paused users ever get;
  // ongoing match delivery is gated by their frequency preference downstream.
  if (!options.welcome && targetUser.frequency === 'Paused') {
    return { sent: false, reason: 'frequency is Paused' }
  }

  // "New" = top 3 freshly-scored matches above threshold that the user
  // hasn't been told about yet (previousNotifiedAt is null). "Top Matches"
  // = top 3 of all matches above threshold this run.
  const allAboveThreshold = scored
    .filter((s) => s.outcome.result.score >= DIGEST_THRESHOLD)
    .sort((a, b) => b.outcome.result.score - a.outcome.result.score)
  // `resend` treats every above-threshold match as unseen for this one send.
  // Purpose-built for testing a template against your own account: without it,
  // anyone already notified about all their matches gets nothing, which reads
  // as a broken trigger rather than a correct no-op.
  const freshAboveThreshold = options.resend
    ? allAboveThreshold
    : allAboveThreshold.filter((s) => s.outcome.previousNotifiedAt === null)

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
    return { sent: true, reason: 'sent welcome' }
  }

  if (options.locationChanged) {
    // Self-service location update on the dashboard — send a
    // location-specific digest IFF the re-scoring surfaced new
    // matches above threshold. Silent no-op when nothing new came
    // into range (typo fix, city we don't have events near, etc.).
    if (!freshAboveThreshold.length) {
      return { sent: false, reason: 'location changed but nothing new came into range' }
    }
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
    return { sent: true, reason: 'sent location-updated digest' }
  }

  // The common no-op, and the one that used to be silent: everything above
  // threshold has already been notified, so there is nothing new to say.
  if (!freshAboveThreshold.length) {
    const reason = allAboveThreshold.length
      ? `already notified about all ${allAboveThreshold.length} matches above threshold — use resend=1 to send anyway`
      : 'no matches above threshold'
    console.log(`process-matches: no digest for ${targetUser.email} — ${reason}`)
    return { sent: false, reason }
  }
  await sendUserDigest(targetUser, {
    newEvents,
    topMatches,
    totalUpcomingMatches: allAboveThreshold.length,
  })
  await markMatchesNotified(
    newEvents.map((e) => ({ eventId: e.event.id, userId: targetUser.id })),
  )
  return { sent: true, reason: `sent digest with ${newEvents.length} event(s)` }
}

type ScoreOutcomeStatus = 'scored' | 'cached' | 'failed'

async function scoreAndNotify(
  event: AirtableEvent,
  user: AirtableUser,
  fixedSide: 'event' | 'user',
  opts: { preNotify?: boolean; existingMatch?: CachedMatchRow | null; force?: boolean } = {},
): Promise<ScoreOutcomeStatus> {
  try {
    const outcome = await scoreFresh(event, user, fixedSide, opts.existingMatch, opts.force)

    // A cache hit means the stored row already holds exactly these values,
    // so re-writing it would be a no-op — skip the round-trip. The one
    // exception is preNotify, which stamps notified_at and therefore has to
    // run even when the scores themselves didn't change.
    if (outcome.cached && !opts.preNotify) return 'cached'

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
  // True when the stored inputs_hash matched, so the scores were reused
  // and no LLM call was made. Callers skip the redundant logMatch write —
  // the row already holds exactly these values.
  cached: boolean
}

// Rebuild a ScoreResult from a previously-stored row. Only called when the
// recomputed inputs hash equals the stored one, which means every field below
// was produced under the same MATCHING_VERSION from the same inputs.
// `reason` isn't persisted (nothing reads it back), so it gets a marker.
function resultFromCachedRow(row: CachedMatchRow, inputsHash: string): ScoreResult {
  return {
    score: row.score ?? 0,
    matchPercent: row.match_percent ?? 0,
    location: row.location_score ?? 0,
    audience: row.audience_score,
    quality: row.quality_score ?? 0,
    preferences: row.preference_score,
    reason: 'cached — inputs unchanged since last scoring',
    skippedReason: (row.skipped_reason as ScoreResult['skippedReason']) ?? null,
    inputsHash,
  }
}

// Reuse the stored scores when the inputs hash is unchanged, so a trigger
// only pays for pairs that actually need rescoring.
//
// This used to re-run the AI unconditionally, because skipping once left a
// stale score behind (Michelle's CMO case): the hash matched her old row, the
// code thought "no work to do," and a new audience-floor boost never landed.
// The real defect there was a rules change that didn't bump MATCHING_VERSION.
// The version is the first field in computeInputsHash, so bumping it changes
// every hash and invalidates every cached row automatically — which makes the
// hash safe to trust here. See the MATCHING_VERSION comment in lib/matching.ts.
//
// `force` (?force=1) is the escape hatch for rescoring without a version bump.
async function scoreFresh(
  event: AirtableEvent,
  user: AirtableUser,
  fixedSide: 'event' | 'user',
  prefetchedMatch?: CachedMatchRow | null,
  force = false,
): Promise<ScoreOutcome> {
  // Use pre-fetched match when available (both triggers pre-load all rows
  // in one query); fall back to per-row lookup.
  const existing = prefetchedMatch !== undefined ? prefetchedMatch : await getExistingMatch(event.id, user.id)
  const previousNotifiedAt = existing?.notified_at ?? null

  if (!force && existing?.inputs_hash) {
    const hash = computeInputsHash(event, user)
    if (hash === existing.inputs_hash) {
      return { previousNotifiedAt, result: resultFromCachedRow(existing as CachedMatchRow, hash), cached: true }
    }
  }

  const result = await scoreEventUser(event, user, fixedSide)
  return { previousNotifiedAt, result, cached: false }
}

export async function GET(req: NextRequest) {
  // This endpoint runs LLM scoring and sends real email, and was previously
  // reachable by anyone who knew a user or event id. Two legitimate callers:
  // an admin's browser (session cookie) and our own route handlers
  // server-to-server (internal secret header).
  if (!(await isInternalOrAdmin(req))) {
    console.warn('process-matches: unauthorized request', {
      trigger: req.nextUrl.searchParams.get('trigger'),
      id: req.nextUrl.searchParams.get('id'),
    })
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

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
    // ?force=1 bypasses the inputs_hash cache and rescores every pair from
    // scratch. Needed when scoring behaviour changed without a
    // MATCHING_VERSION bump; routine triggers should leave it off.
    const force = searchParams.get('force') === '1'
    // ?resend=1 re-sends matches the user was already notified about. Test-only
    // escape hatch; routine triggers must leave it off or users get duplicates.
    const resend = searchParams.get('resend') === '1'
    if (trigger === 'event') {
      const resetNotified = searchParams.get('resetNotified') === '1'
      await processEventTrigger(id, force, resetNotified)
      return NextResponse.json({ ok: true })
    }
    if (trigger === 'user') {
      // Report whether an email actually went out. The old bare { ok: true }
      // was indistinguishable from a no-op, so a correct "nothing new to send"
      // looked exactly like a broken trigger.
      const result = await processUserTrigger(id, { noEmail, welcome, locationChanged, force, resend })
      return NextResponse.json({ ok: true, ...result })
    }
    return NextResponse.json({ error: 'trigger must be "event" or "user"' }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('process-matches error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
