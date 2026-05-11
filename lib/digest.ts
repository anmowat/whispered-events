import {
  AirtableEvent,
  AirtableUser,
  getActiveUsers,
  getFutureEvents,
} from './airtable'
import { isMatchEligible } from './matching'
import { sendUserDigest } from './email'
import {
  getUnnotifiedMatchesForUser,
  getUpcomingMatchesForUser,
  markMatchesNotified,
  getDigestState,
  upsertDigestState,
} from './supabase'

export const DIGEST_SCORE_THRESHOLD = 1.0
export const DIGEST_CAP_PER_SECTION = 3

const PT_TIME_ZONE = 'America/Los_Angeles'

// Returns the YYYY-MM-DD date string of `now` interpreted in Pacific Time.
export function ymdInPT(now: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: PT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(now)
}

// Returns the weekday (0=Sun..6=Sat) of `now` in Pacific Time.
function weekdayInPT(now: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PT_TIME_ZONE,
    weekday: 'short',
  })
  const weekdayStr = fmt.format(now)
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[weekdayStr] ?? 0
}

// Adds `days` (can be negative) to a YYYY-MM-DD string and returns YYYY-MM-DD.
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const utc = Date.UTC(y, m - 1, d) + days * 86_400_000
  const dt = new Date(utc)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// Returns the next Sunday strictly AFTER `now`. If `now` is itself Sunday in PT,
// returns the Sunday 7 days out (signups shouldn't trigger same-day emails).
export function nextSundayAfter(now: Date): string {
  const today = ymdInPT(now)
  const dow = weekdayInPT(now)
  const daysUntilSun = dow === 0 ? 7 : 7 - dow
  return addDays(today, daysUntilSun)
}

async function processUser(
  user: AirtableUser,
  futureById: Map<string, AirtableEvent>,
): Promise<{ sent: boolean }> {
  const futureIds = Array.from(futureById.keys())
  const newMatches = await getUnnotifiedMatchesForUser(
    user.id,
    futureIds,
    DIGEST_SCORE_THRESHOLD,
  )
  if (newMatches.length === 0) return { sent: false }

  const topNew = newMatches.slice(0, DIGEST_CAP_PER_SECTION)
  const newEventIds = new Set(topNew.map((m) => m.event_id))

  const allUpcoming = await getUpcomingMatchesForUser(
    user.id,
    futureIds,
    DIGEST_SCORE_THRESHOLD,
  )
  const remaining = allUpcoming.filter((m) => !newEventIds.has(m.event_id))
  const topMatches = remaining.slice(0, DIGEST_CAP_PER_SECTION)

  const totalCandidateCount = newMatches.length + remaining.length

  await sendUserDigest(user, {
    newEvents: topNew
      .map((m) => futureById.get(m.event_id))
      .filter((e): e is AirtableEvent => !!e),
    topMatches: topMatches
      .map((m) => futureById.get(m.event_id))
      .filter((e): e is AirtableEvent => !!e),
    totalCandidateCount,
  })

  await markMatchesNotified(
    topNew.map((m) => ({ eventId: m.event_id, userId: user.id })),
  )

  return { sent: true }
}

export async function runDigests(now: Date): Promise<{
  weekly: { processed: number; sent: number }
  monthly: { processed: number; sent: number }
}> {
  const todayPT = ymdInPT(now)
  const allUsers = (await getActiveUsers()).filter(isMatchEligible)
  const futureEvents = await getFutureEvents()
  const futureById = new Map(futureEvents.map((e) => [e.id, e]))

  let weeklyProcessed = 0
  let weeklySent = 0
  let monthlyProcessed = 0
  let monthlySent = 0

  for (const user of allUsers) {
    if (user.frequency === 'Weekly When New Events') {
      weeklyProcessed += 1
      const result = await processUser(user, futureById)
      if (result.sent) weeklySent += 1
    } else if (user.frequency === 'Monthly When New Events') {
      const state = await getDigestState(user.id)
      // Missing state row: treat as due today so we don't strand pre-existing
      // users, and seed a row going forward.
      const dueDate = state?.next_monthly_digest_at ?? todayPT
      if (dueDate <= todayPT) {
        monthlyProcessed += 1
        const result = await processUser(user, futureById)
        if (result.sent) monthlySent += 1
        await upsertDigestState(user.id, {
          nextMonthly: addDays(todayPT, 28),
          lastSent: result.sent
            ? now.toISOString()
            : state?.last_monthly_digest_sent_at ?? null,
        })
      }
    }
    // 'Each New Event' and 'Dashboard Only' are not processed by cron.
  }

  return {
    weekly: { processed: weeklyProcessed, sent: weeklySent },
    monthly: { processed: monthlyProcessed, sent: monthlySent },
  }
}

// Per-event each-new-event path: build the same digest payload but with the
// just-matched event as the single "new" entry. Returns true if an email was
// sent. The caller is responsible for marking the triggering match notified.
export async function sendEachNewEventDigest(
  user: AirtableUser,
  triggeringEvent: AirtableEvent,
): Promise<boolean> {
  const futureEvents = await getFutureEvents()
  const futureById = new Map(futureEvents.map((e) => [e.id, e]))
  // Ensure the triggering event is in the upcoming pool (it may have just been
  // scored but not yet visible to a fresh query in rare races).
  if (!futureById.has(triggeringEvent.id)) {
    futureById.set(triggeringEvent.id, triggeringEvent)
  }
  const futureIds = Array.from(futureById.keys())

  const allUpcoming = await getUpcomingMatchesForUser(
    user.id,
    futureIds,
    DIGEST_SCORE_THRESHOLD,
  )
  const topMatches = allUpcoming
    .filter((m) => m.event_id !== triggeringEvent.id)
    .slice(0, DIGEST_CAP_PER_SECTION)
  const totalCandidateCount = 1 + allUpcoming.filter((m) => m.event_id !== triggeringEvent.id).length

  await sendUserDigest(user, {
    newEvents: [triggeringEvent],
    topMatches: topMatches
      .map((m) => futureById.get(m.event_id))
      .filter((e): e is AirtableEvent => !!e),
    totalCandidateCount,
  })

  await markMatchesNotified([{ eventId: triggeringEvent.id, userId: user.id }])
  return true
}
