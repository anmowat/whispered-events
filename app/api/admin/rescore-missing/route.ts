import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import {
  getActiveUsers,
  getFutureEvents,
  invalidateEventCache,
  invalidateUserCache,
} from '@/lib/airtable'
import { isMatchEligible, scoreEventUser } from '@/lib/matching'
import { getExistingMatchPairs, logMatch } from '@/lib/supabase'

// Backfill endpoint: scores every (eligible user × future event) pair that
// has no row in `matches` and writes it. Used to recover from missed event
// triggers (e.g. waitUntil failures, Claude rate limits, transient blips).
// No emails are sent — this is a pure repair op. The dashboard / cron
// digest will pick the new rows up on the next user-facing read.

export const maxDuration = 300

const BATCH_SIZE = 25

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Bust Airtable caches so a missing row from a freshly-created event
  // doesn't get skipped because the 90s cache is stale.
  invalidateEventCache()
  invalidateUserCache()

  const [allUsers, futureEvents] = await Promise.all([
    getActiveUsers(),
    getFutureEvents(),
  ])
  const users = allUsers.filter(isMatchEligible)
  const existing = await getExistingMatchPairs(futureEvents.map((e) => e.id))

  const missing: Array<{ eventIdx: number; userIdx: number }> = []
  for (let ei = 0; ei < futureEvents.length; ei++) {
    const event = futureEvents[ei]
    for (let ui = 0; ui < users.length; ui++) {
      const user = users[ui]
      if (!existing.has(`${event.id}:${user.id}`)) {
        missing.push({ eventIdx: ei, userIdx: ui })
      }
    }
  }

  let scored = 0
  let failed = 0
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE)
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
    pairsMissing: missing.length,
    scored,
    failed,
  })
}
