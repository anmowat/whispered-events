import {
  AirtableEvent,
  AirtableUser,
  getActiveUsers,
  getFutureEvents,
} from './airtable'
import { isMatchEligible } from './matching'
import { sendUserDigest, sendCoaching } from './email'
import type { DigestEventEntry } from './email'
import { withinMiles } from './geocode'
import {
  DigestMatchRow,
  getUnnotifiedMatchesForUser,
  getUpcomingMatchesForUser,
  getLastDigestSentByEmail,
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

function toEntries(
  rows: DigestMatchRow[],
  futureById: Map<string, AirtableEvent>,
): DigestEventEntry[] {
  const entries: DigestEventEntry[] = []
  for (const row of rows) {
    const event = futureById.get(row.event_id)
    if (!event) continue
    const matchPercent =
      row.match_percent ??
      Math.max(0, Math.min(100, Math.round((row.score / 3.0) * 100)))
    entries.push({ event, matchPercent })
  }
  return entries
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

  // Top Matches = absolute top 3 upcoming above threshold; overlap with
  // New is allowed (the email template renders dupes compactly).
  const allUpcoming = await getUpcomingMatchesForUser(
    user.id,
    futureIds,
    DIGEST_SCORE_THRESHOLD,
  )
  const top = allUpcoming.slice(0, DIGEST_CAP_PER_SECTION)

  await sendUserDigest(user, {
    newEvents: toEntries(topNew, futureById),
    topMatches: toEntries(top, futureById),
  })

  await markMatchesNotified(
    topNew.map((m) => ({ eventId: m.event_id, userId: user.id })),
  )

  return { sent: true }
}

// Coaching = nudge for users with nothing to send. Gated by grade
// (B/C never get coached — they couldn't clear the threshold anyway)
// and a 28-day floor since their last digest/coaching send.
const COACHING_FLOOR_DAYS = 28
// Suppress Weekly/Monthly cron sends for anyone we've already emailed
// in the last week. Stops the cron from dropping a second digest on
// users whose matches were just re-run manually (via the Airtable
// Match checkbox) or who got a per-event 'As they arrive' digest mid-
// week. 'As they arrive' is unaffected — it already has its own 28-day
// coaching floor.
const CRON_RECENT_TOUCH_DAYS = 7
const NEARBY_RADIUS_MILES = 100

function isCoachingEligible(
  user: AirtableUser,
  lastSentIso: string | null,
  now: Date,
): boolean {
  if (user.grade === 'B' || user.grade === 'C') return false
  if (user.frequency === 'Paused') return false
  if (!lastSentIso) return true
  const cutoff = now.getTime() - COACHING_FLOOR_DAYS * 86_400_000
  const t = new Date(lastSentIso).getTime()
  return Number.isFinite(t) && t < cutoff
}

function recentlyTouched(
  lastSentIso: string | null,
  now: Date,
  daysFloor: number,
): boolean {
  if (!lastSentIso) return false
  const cutoff = now.getTime() - daysFloor * 86_400_000
  const t = new Date(lastSentIso).getTime()
  return Number.isFinite(t) && t >= cutoff
}

// Reused inline pattern from app/api/admin/dashboard-counts/route.ts —
// count future events within 100mi of each user's geocoded location.
// Users with no lat/lng get 0 (which routes them to Variant A copy).
function buildNearbyCountMap(
  users: AirtableUser[],
  futureEvents: AirtableEvent[],
): Map<string, number> {
  const geocodedEvents = futureEvents.filter(
    (e): e is AirtableEvent & { lat: number; lng: number } =>
      typeof e.lat === 'number' && typeof e.lng === 'number',
  )
  const out = new Map<string, number>()
  for (const u of users) {
    if (typeof u.lat !== 'number' || typeof u.lng !== 'number') {
      out.set(u.id, 0)
      continue
    }
    const userPoint = { lat: u.lat, lng: u.lng }
    let n = 0
    for (const e of geocodedEvents) {
      if (withinMiles(userPoint, { lat: e.lat, lng: e.lng }, NEARBY_RADIUS_MILES)) n++
    }
    out.set(u.id, n)
  }
  return out
}

interface FrequencyStats {
  processed: number
  sent: number
  coached: number
  skippedRecent: number
}

export async function runDigests(now: Date): Promise<{
  weekly: FrequencyStats
  monthly: FrequencyStats
  arrive: { coached: number }
}> {
  const todayPT = ymdInPT(now)
  const allUsers = (await getActiveUsers()).filter(isMatchEligible)
  const futureEvents = await getFutureEvents()
  const futureById = new Map(futureEvents.map((e) => [e.id, e]))
  const lastSentByEmail = await getLastDigestSentByEmail()
  const nearbyByUserId = buildNearbyCountMap(allUsers, futureEvents)

  const weekly: FrequencyStats = { processed: 0, sent: 0, coached: 0, skippedRecent: 0 }
  const monthly: FrequencyStats = { processed: 0, sent: 0, coached: 0, skippedRecent: 0 }
  let arriveCoached = 0

  for (const user of allUsers) {
    const lastSent = lastSentByEmail.get(user.email.trim().toLowerCase()) ?? null
    const nearbyCount = nearbyByUserId.get(user.id) ?? 0
    // 7-day floor blocks cron from piling on top of a recent manual
    // re-run or mid-week per-event send. We don't touch their Monthly
    // due date when we skip — they re-enter next Monday.
    const wasRecentlyTouched = recentlyTouched(lastSent, now, CRON_RECENT_TOUCH_DAYS)

    if (user.frequency === 'Weekly') {
      if (wasRecentlyTouched) {
        weekly.skippedRecent += 1
        continue
      }
      weekly.processed += 1
      const result = await processUser(user, futureById)
      if (result.sent) {
        weekly.sent += 1
      } else if (isCoachingEligible(user, lastSent, now)) {
        await safelySendCoaching(user, nearbyCount)
        weekly.coached += 1
      }
    } else if (user.frequency === 'Monthly') {
      const state = await getDigestState(user.id)
      // Missing state row: treat as due today so we don't strand
      // pre-existing users, and seed a row going forward.
      const dueDate = state?.next_monthly_digest_at ?? todayPT
      if (dueDate <= todayPT) {
        if (wasRecentlyTouched) {
          // Don't bump next_monthly_digest_at — we want to re-evaluate
          // them next Monday once the 7-day window has cleared.
          monthly.skippedRecent += 1
          continue
        }
        monthly.processed += 1
        const result = await processUser(user, futureById)
        let touched = result.sent
        if (!result.sent && isCoachingEligible(user, lastSent, now)) {
          await safelySendCoaching(user, nearbyCount)
          monthly.coached += 1
          touched = true
        } else if (result.sent) {
          monthly.sent += 1
        }
        await upsertDigestState(user.id, {
          nextMonthly: addDays(todayPT, COACHING_FLOOR_DAYS),
          // Stamp last-sent for both digest and coaching outcomes so the
          // 28-day floor reflects when the user was most recently
          // touched, not just when a digest with events went out.
          lastSent: touched
            ? now.toISOString()
            : state?.last_monthly_digest_sent_at ?? null,
        })
      }
    } else if (user.frequency === 'As they arrive') {
      // Per-event scoring path already handles their digests. Cron only
      // handles their coaching nudge.
      if (isCoachingEligible(user, lastSent, now)) {
        await safelySendCoaching(user, nearbyCount)
        arriveCoached += 1
      }
    }
    // 'Paused' is intentionally skipped.
  }

  return { weekly, monthly, arrive: { coached: arriveCoached } }
}

// One failed coaching send (Resend hiccup, transient Supabase error)
// shouldn't fail the whole cron and leave subsequent users unprocessed.
// Mirrors the per-user try/catch pattern used in processEventTrigger.
async function safelySendCoaching(
  user: AirtableUser,
  nearbyCount: number,
): Promise<void> {
  try {
    await sendCoaching(user, nearbyCount)
  } catch (err) {
    console.error(
      `runDigests: sendCoaching failed for ${user.email}`,
      err instanceof Error ? err.message : String(err),
    )
  }
}

// Per-event each-new-event path: build the same digest payload but with the
// just-matched event as the single "new" entry.
export async function sendEachNewEventDigest(
  user: AirtableUser,
  triggeringEvent: AirtableEvent,
  triggeringMatchPercent: number,
): Promise<boolean> {
  const futureEvents = await getFutureEvents()
  const futureById = new Map(futureEvents.map((e) => [e.id, e]))
  if (!futureById.has(triggeringEvent.id)) {
    futureById.set(triggeringEvent.id, triggeringEvent)
  }
  const futureIds = Array.from(futureById.keys())

  const allUpcoming = await getUpcomingMatchesForUser(
    user.id,
    futureIds,
    DIGEST_SCORE_THRESHOLD,
  )
  // Top Matches = absolute top 3 (may include the triggering event; the
  // email template renders dupes compactly via "see above").
  const topMatchesRows = allUpcoming.slice(0, DIGEST_CAP_PER_SECTION)

  await sendUserDigest(
    user,
    {
      newEvents: [{ event: triggeringEvent, matchPercent: triggeringMatchPercent }],
      topMatches: toEntries(topMatchesRows, futureById),
    },
    'per_event',
  )

  await markMatchesNotified([{ eventId: triggeringEvent.id, userId: user.id }])
  return true
}
