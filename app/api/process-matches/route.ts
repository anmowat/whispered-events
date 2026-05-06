import { NextRequest, NextResponse } from 'next/server'
import {
  getActiveUsers,
  getFutureEvents,
  getUserById,
  AirtableEvent,
  AirtableUser,
} from '@/lib/airtable'
import {
  scoreEventUser,
  isMatchEligible,
  computeInputsHash,
  ScoreResult,
} from '@/lib/matching'
import { getExistingMatch, logMatch } from '@/lib/supabase'
import { sendEventNotification, sendUserDigest } from '@/lib/email'

const SCORE_THRESHOLD = 1.0
const DIGEST_THRESHOLD = 1.5
const BATCH_SIZE = 50

async function processEventTrigger(eventId: string) {
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

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)
    await Promise.all(batch.map((user) => scoreAndNotify(event, user, 'event')))
  }
}

async function processUserTrigger(userId: string) {
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
      `process-matches: user ${targetUser.email} is not eligible (missing Grade/Function/Seniority/FullExp), skipping`,
    )
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

  // Digest the top-5 above DIGEST_THRESHOLD, but only include freshly-scored matches
  // — cached rows have already triggered an email previously.
  const topMatches = scored
    .filter((s) => !s.outcome.cached && s.outcome.result.score >= DIGEST_THRESHOLD)
    .sort((a, b) => b.outcome.result.score - a.outcome.result.score)
    .slice(0, 5)

  if (topMatches.length) {
    await sendUserDigest(
      targetUser,
      topMatches.map((m) => m.event),
    )
  }
}

async function scoreAndNotify(
  event: AirtableEvent,
  user: AirtableUser,
  fixedSide: 'event' | 'user',
) {
  try {
    const outcome = await scoreOrReuse(event, user, fixedSide)

    if (outcome.cached) {
      // Already persisted with the same inputs; user was already notified at this score.
      return
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

    if (result.score < SCORE_THRESHOLD) return
    await sendEventNotification(user, event)
  } catch (err) {
    console.error(`process-matches: error for user ${user.email} / event ${event.id}:`, err)
  }
}

interface ScoreOutcome {
  cached: boolean
  result: ScoreResult
}

async function scoreOrReuse(
  event: AirtableEvent,
  user: AirtableUser,
  fixedSide: 'event' | 'user',
): Promise<ScoreOutcome> {
  const hash = computeInputsHash(event, user)
  const existing = await getExistingMatch(event.id, user.id)
  if (existing && existing.inputs_hash === hash) {
    return {
      cached: true,
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
  return { cached: false, result }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const trigger = searchParams.get('trigger')
  const id = searchParams.get('id')

  if (!trigger || !id) {
    return NextResponse.json({ error: 'trigger and id are required' }, { status: 400 })
  }

  try {
    if (trigger === 'event') {
      await processEventTrigger(id)
    } else if (trigger === 'user') {
      await processUserTrigger(id)
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
