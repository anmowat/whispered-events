import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { invalidateEventCache, invalidateUserCache } from '@/lib/airtable'
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

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  invalidateEventCache()
  invalidateUserCache()

  const [allUsers, futureEvents] = await Promise.all([
    getActiveUsers(),
    getFutureEvents(),
  ])
  const users = allUsers.filter(isMatchEligible)
  const existing = await getExistingMatchHashes(futureEvents.map((e) => e.id))

  // Pre-compute the current hash for every pair so we can classify
  // existing rows as fresh (skip) vs stale (re-score) in one pass.
  const toScore: Array<{ eventIdx: number; userIdx: number; status: 'missing' | 'stale' }> = []
  for (let ei = 0; ei < futureEvents.length; ei++) {
    const event = futureEvents[ei]
    for (let ui = 0; ui < users.length; ui++) {
      const user = users[ui]
      const key = `${event.id}:${user.id}`
      if (!existing.has(key)) {
        toScore.push({ eventIdx: ei, userIdx: ui, status: 'missing' })
        continue
      }
      const storedHash = existing.get(key)
      const currentHash = computeInputsHash(event, user)
      if (storedHash !== currentHash) {
        toScore.push({ eventIdx: ei, userIdx: ui, status: 'stale' })
      }
    }
  }

  const missing = toScore.filter((t) => t.status === 'missing').length
  const stale = toScore.filter((t) => t.status === 'stale').length

  let scored = 0
  let failed = 0
  for (let i = 0; i < toScore.length; i += BATCH_SIZE) {
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

  return NextResponse.json({
    ok: true,
    eligibleUsers: users.length,
    futureEvents: futureEvents.length,
    pairsTotal: users.length * futureEvents.length,
    pairsExisting: existing.size,
    pairsMissing: missing,
    pairsStale: stale,
    scored,
    failed,
  })
}
