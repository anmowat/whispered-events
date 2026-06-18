import {
  AirtableEvent,
  AirtableUser,
  getActiveUsers,
  getFutureEvents,
} from './airtable'
import { isMatchEligible } from './matching'
import { sendUserDigest, sendCoaching, sendRecap } from './email'
import type { DigestEventEntry } from './email'
import { withinMiles } from './geocode'
import {
  DigestMatchRow,
  getMatchCountsByEmail,
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
    totalUpcomingMatches: allUpcoming.length,
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
// Resend's free tier allows 5 req/sec. Pause this long between any two
// outbound emails so we stay safely under and don't 429. At ~50 users
// per cron run with ~half getting sends, this adds ~6 seconds total —
// trivial against the 300s maxDuration.
const RESEND_THROTTLE_MS = 250
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  recapped: number
  coached: number
  skippedRecent: number
}

export async function runDigests(now: Date): Promise<{
  weekly: FrequencyStats
  monthly: FrequencyStats
  arrive: { recapped: number; coached: number }
}> {
  const todayPT = ymdInPT(now)
  const allUsers = (await getActiveUsers()).filter(isMatchEligible)
  const futureEvents = await getFutureEvents()
  const futureById = new Map(futureEvents.map((e) => [e.id, e]))
  const futureIds = futureEvents.map((e) => e.id)
  const lastSentByEmail = await getLastDigestSentByEmail()
  const nearbyByUserId = buildNearbyCountMap(allUsers, futureEvents)
  // Total above-threshold match count per user — used to distinguish
  // 'no matches at all' (true coaching path) from 'has matches but
  // none unnotified' (recap path). Single bulk query covers everyone.
  const matchCountByEmail = await getMatchCountsByEmail(futureIds)

  const weekly: FrequencyStats = { processed: 0, sent: 0, recapped: 0, coached: 0, skippedRecent: 0 }
  const monthly: FrequencyStats = { processed: 0, sent: 0, recapped: 0, coached: 0, skippedRecent: 0 }
  let arriveRecapped = 0
  let arriveCoached = 0

  for (const user of allUsers) {
    const lastSent = lastSentByEmail.get(user.email.trim().toLowerCase()) ?? null
    const nearbyCount = nearbyByUserId.get(user.id) ?? 0
    // matchCount uses the raw email key (matches the lookup pattern in
    // admin/dashboard-counts). Total events at-or-above NOTIFY_THRESHOLD
    // for this user, future events only, skipped rows excluded.
    const matchCount = matchCountByEmail.get(user.email) ?? 0
    // 7-day floor blocks cron from piling on top of a recent manual
    // re-run or mid-week per-event send. We don't touch their Monthly
    // due date when we skip — they re-enter next Monday.
    const wasRecentlyTouched = recentlyTouched(lastSent, now, CRON_RECENT_TOUCH_DAYS)

    let didSend = false

    if (user.frequency === 'Weekly') {
      if (wasRecentlyTouched) {
        weekly.skippedRecent += 1
        continue
      }
      weekly.processed += 1
      const result = await processUser(user, futureById)
      if (result.sent) {
        weekly.sent += 1
        didSend = true
      } else if (isCoachingEligible(user, lastSent, now)) {
        if (matchCount > 0) {
          await safelySendRecap(user, futureById, futureIds, nearbyCount, matchCount)
          weekly.recapped += 1
          didSend = true
        } else {
          await safelySendCoaching(user, nearbyCount)
          weekly.coached += 1
          didSend = true
        }
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
        if (result.sent) {
          monthly.sent += 1
          didSend = true
        } else if (isCoachingEligible(user, lastSent, now)) {
          if (matchCount > 0) {
            await safelySendRecap(user, futureById, futureIds, nearbyCount, matchCount)
            monthly.recapped += 1
          } else {
            await safelySendCoaching(user, nearbyCount)
            monthly.coached += 1
          }
          touched = true
          didSend = true
        }
        await upsertDigestState(user.id, {
          nextMonthly: addDays(todayPT, COACHING_FLOOR_DAYS),
          // Stamp last-sent for digest / recap / coaching outcomes so
          // the 28-day floor reflects when the user was most recently
          // touched, not just when a digest with events went out.
          lastSent: touched
            ? now.toISOString()
            : state?.last_monthly_digest_sent_at ?? null,
        })
      }
    } else if (user.frequency === 'As they arrive') {
      // Per-event scoring path already handles their digests. Cron only
      // handles the dormancy nudge — recap if they have matches,
      // coaching if they don't.
      if (!isCoachingEligible(user, lastSent, now)) continue
      if (matchCount > 0) {
        await safelySendRecap(user, futureById, futureIds, nearbyCount, matchCount)
        arriveRecapped += 1
        didSend = true
      } else {
        await safelySendCoaching(user, nearbyCount)
        arriveCoached += 1
        didSend = true
      }
    }
    // 'Paused' is intentionally skipped.

    // Stay under Resend's 5/sec rate limit. Skipped/no-op iterations
    // pay no delay; only iterations that fired a Resend call wait
    // before the next user is processed.
    if (didSend) await sleep(RESEND_THROTTLE_MS)
  }

  return {
    weekly,
    monthly,
    arrive: { recapped: arriveRecapped, coached: arriveCoached },
  }
}

// Daily batched digest for "As they arrive" users. Runs at 02:00 UTC
// (7 PM PT the previous day) every day. Per-user flow is identical to the weekly
// cron — same `processUser` helper, same 3-event cap, same
// `markMatchesNotified` stamping — but the recently-touched floor is
// 1 day instead of 7 so a same-day re-run doesn't double-send.
//
// Dormancy nudges for As-they-arrive users still fire from the Monday
// runDigests (line 297–311); this function only handles the digest
// path. Users with no unnotified matches are silently skipped.
const DAILY_RECENT_TOUCH_DAYS = 1

export async function runDailyArriveDigests(now: Date): Promise<{
  arrive: FrequencyStats
}> {
  const allUsers = (await getActiveUsers()).filter(isMatchEligible)
  const futureEvents = await getFutureEvents()
  const futureById = new Map(futureEvents.map((e) => [e.id, e]))
  const lastSentByEmail = await getLastDigestSentByEmail()

  const arrive: FrequencyStats = {
    processed: 0,
    sent: 0,
    recapped: 0,
    coached: 0,
    skippedRecent: 0,
  }

  for (const user of allUsers) {
    if (user.frequency !== 'As they arrive') continue
    const lastSent = lastSentByEmail.get(user.email.trim().toLowerCase()) ?? null
    if (recentlyTouched(lastSent, now, DAILY_RECENT_TOUCH_DAYS)) {
      arrive.skippedRecent += 1
      continue
    }
    arrive.processed += 1
    let didSend = false
    try {
      const result = await processUser(user, futureById)
      if (result.sent) {
        arrive.sent += 1
        didSend = true
      }
    } catch (err) {
      console.error(
        `runDailyArriveDigests: processUser failed for ${user.email}`,
        err instanceof Error ? err.message : String(err),
      )
    }
    if (didSend) await sleep(RESEND_THROTTLE_MS)
  }

  return { arrive }
}

// Recap path: user has matching events but nothing new to tell them.
// Fetches the top 3 upcoming matches and hands them to sendRecap.
// Wrapped in try/catch so a single Resend hiccup doesn't tank the
// whole cron run (mirrors safelySendCoaching).
async function safelySendRecap(
  user: AirtableUser,
  futureById: Map<string, AirtableEvent>,
  futureIds: string[],
  nearbyCount: number,
  totalMatchCount: number,
): Promise<void> {
  try {
    const upcoming = await getUpcomingMatchesForUser(
      user.id,
      futureIds,
      DIGEST_SCORE_THRESHOLD,
    )
    const top = upcoming.slice(0, DIGEST_CAP_PER_SECTION)
    const topEntries = toEntries(top, futureById)
    // If the join against futureById comes up empty (e.g. all the
    // user's matched events were just removed), skip — no recap to
    // send. We don't fall back to a no-event variant because the
    // matchCount precondition implies the rows exist.
    if (topEntries.length === 0) return
    await sendRecap(user, topEntries, nearbyCount, totalMatchCount)
  } catch (err) {
    console.error(
      `runDigests: sendRecap failed for ${user.email}`,
      err instanceof Error ? err.message : String(err),
    )
  }
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
