import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { getActiveUsers } from '@/lib/users'
import { getFutureEvents } from '@/lib/events'
import { isMatchEligible, scoreEventUser, computeInputsHash } from '@/lib/matching'
import { getExistingMatchHashes, logMatch } from '@/lib/supabase'

// Backfill endpoint: scores every (eligible user × future event) pair that
// is either missing from `matches` OR has a stale inputs_hash (the model
// version, rubric, or scoring formula has changed since the row was
// written). No emails are sent — this is a pure repair op. The dashboard
// and cron digest pick up the new rows on the next read.
//
// One button heals two things at once:
//   - Missed event triggers (waitUntil failure, Claude rate limit, etc.)
//   - Old-model rows after a MATCHING_VERSION bump

export const maxDuration = 300

const BATCH_SIZE = 25
// Bail out of the score loop with this much budget left so the response
// can serialize and return cleanly. maxDuration is 300s; leaving ~20s
// of headroom matters because Promise.all batches block on the slowest
// LLM call in the batch.
const DEADLINE_MS = 280_000

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const start = Date.now()

  const [allUsers, futureEvents] = await Promise.all([
    getActiveUsers(),
    getFutureEvents(),
  ])
  const users = allUsers.filter(isMatchEligible)
  const existing = await getExistingMatchHashes(futureEvents.map((e) => e.id))

  // Pre-compute the current hash for every pair so we can classify
  // existing rows as fresh (skip) vs stale (re-score) in one pass.
  // Sort cheap (no-LLM) short-circuit pairs to the front so we drain
  // them first — a version bump invalidates every pair, but the
  // grade_c / location_zero / women_only ones return in microseconds.
  // That way one pass already healed most of the work even if we hit
  // the deadline before the slow LLM-bound pairs all complete.
  const toScore: Array<{
    eventIdx: number
    userIdx: number
    status: 'missing' | 'stale'
    isFast: boolean
  }> = []
  for (let ei = 0; ei < futureEvents.length; ei++) {
    const event = futureEvents[ei]
    const womenOnly = (event.audience ?? []).some((tag) =>
      /\bwomen\b|\bwomxn\b|\bfemale\b/i.test(tag),
    )
    for (let ui = 0; ui < users.length; ui++) {
      const user = users[ui]
      const key = `${event.id}:${user.id}`
      const fast =
        user.grade === 'C' ||
        (womenOnly && !/\bwomen\b|\bwomxn\b|\bfemale\b/i.test(user.interest || ''))
      if (!existing.has(key)) {
        toScore.push({ eventIdx: ei, userIdx: ui, status: 'missing', isFast: fast })
        continue
      }
      const storedHash = existing.get(key)
      const currentHash = computeInputsHash(event, user)
      if (storedHash !== currentHash) {
        toScore.push({ eventIdx: ei, userIdx: ui, status: 'stale', isFast: fast })
      }
    }
  }
  toScore.sort((a, b) => Number(b.isFast) - Number(a.isFast))

  const missing = toScore.filter((t) => t.status === 'missing').length
  const stale = toScore.filter((t) => t.status === 'stale').length

  let scored = 0
  let failed = 0
  let deadlineHit = false
  for (let i = 0; i < toScore.length; i += BATCH_SIZE) {
    if (Date.now() - start > DEADLINE_MS) {
      deadlineHit = true
      break
    }
    const batch = toScore.slice(i, i + BATCH_SIZE)
    const settled = await Promise.all(
      batch.map(async ({ eventIdx, userIdx }) => {
        const event = futureEvents[eventIdx]
        const user = users[userIdx]
        try {
          const result = await scoreEventUser(event, user, 'event')
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
          return true
        } catch (err) {
          console.error(
            `rescore-missing: failed for user ${user.email} / event ${event.id}:`,
            err,
          )
          return false
        }
      }),
    )
    for (const ok of settled) ok ? scored++ : failed++
  }

  // `done` is the signal the admin button watches when looping: if the
  // deadline was hit, more passes are needed; if not, every stale/
  // missing pair was processed (successes refreshed their hash; failures
  // will reappear as stale on the next call and get retried).
  const done = !deadlineHit
  return NextResponse.json({
    ok: true,
    done,
    eligibleUsers: users.length,
    futureEvents: futureEvents.length,
    pairsTotal: users.length * futureEvents.length,
    pairsExisting: existing.size,
    pairsMissing: missing,
    pairsStale: stale,
    scored,
    failed,
    elapsedMs: Date.now() - start,
  })
}
