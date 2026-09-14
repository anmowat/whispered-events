import { NextRequest, NextResponse } from 'next/server'
import { verifySession, getMatchScoresForUser, listShareContacts } from '@/lib/supabase'
import { getFutureEvents } from '@/lib/events'
import { getUserByEmail } from '@/lib/users'
import { getContactAttendance, attendanceCounts } from '@/lib/contact-attendance'

const MATCH_PERCENT_THRESHOLD = 40
const ENGAGEMENT_CAP = 7

// Returns upcoming events where match_percent >= 40 for the logged-in user.
// Pass ?all=1 to bypass the engagement cap and rating filter (admin/debug).
export async function GET(req: NextRequest) {
  const sessionToken = req.cookies.get('session')?.value

  if (!sessionToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const session = await verifySession(sessionToken)

  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const showAll = req.nextUrl.searchParams.get('all') === '1'

  // getFutureEvents throws on a Supabase error rather than returning [] —
  // returning an empty dashboard would look like "you have no matches"
  // instead of "we couldn't load them". Surface it as a real 500.
  let futureEvents
  let scores
  try {
    ;[futureEvents, scores] = await Promise.all([
      getFutureEvents(),
      getMatchScoresForUser(session.userId),
    ])
  } catch (err) {
    console.error('dashboard/events: load failed', err)
    return NextResponse.json({ error: 'could not load events' }, { status: 500 })
  }

  // Contacts attending, from the shared privacy-aware reader. Costs one
  // indexed query for the overwhelming majority of members, who have nobody
  // sharing with them and short-circuit immediately.
  let attendance = new Map<string, number>()
  // The two counts shown beside the sharing rows on the profile card. Both
  // come from the readers that back the MODALS, so the number on the row is
  // always the number you see when you open it - a raw row count would include
  // deactivated owners and revoked follows and read as broken.
  let sharedWithMeCount = 0
  let sharingWithCount = 0
  try {
    const me = await getUserByEmail(session.email)
    const contactAttendance = await getContactAttendance(session.email, me?.findable)
    attendance = attendanceCounts(contactAttendance)
    // Already computed above - free. Empty for findable='none', which is what
    // makes the count disappear for members who opted out of receiving.
    sharedWithMeCount = contactAttendance.contacts.length
  } catch (err) {
    // A soft signal must never take the dashboard down with it.
    console.error('dashboard/events: contact attendance failed', err)
  }
  try {
    sharingWithCount = (await listShareContacts(session.userId)).length
  } catch (err) {
    console.error('dashboard/events: share contact count failed', err)
  }

  const withScores = futureEvents.map((e) => {
    const entry = scores.get(e.id)
    return {
      ...e,
      contactsAttending: attendance.get(e.id) ?? 0,
      matchScore: entry?.score ?? null,
      matchPercent: entry?.matchPercent ?? null,
      rating: entry?.rating ?? null,
      ratingReason: entry?.ratingReason ?? null,
      hostRating: entry?.hostRating ?? null,
      firstRatedAt: entry?.firstRatedAt ?? null,
    }
  })

  // Hard hide not_a_fit: once a user rates not_a_fit or a host rates down,
  // the event drops off the dashboard. The row persists for analytics.
  // ?all=1 bypasses both filters for admin/debug viewing.
  const filtered = showAll
    ? withScores
    : withScores.filter(
        (e) =>
          (e.matchPercent ?? 0) >= MATCH_PERCENT_THRESHOLD &&
          e.rating !== 'not_a_fit' &&
          e.hostRating !== 'down',
      )

  // Engagement gate: cap never-rated matches at ENGAGEMENT_CAP.
  // Ever-rated matches (first_rated_at IS NOT NULL) always stay visible.
  // Un-rating a match doesn't free its slot — first_rated_at is permanent.
  const everRated = filtered.filter((e) => e.firstRatedAt != null)
  const neverRated = filtered
    .filter((e) => e.firstRatedAt == null)
    .sort((a, b) => (b.matchPercent ?? 0) - (a.matchPercent ?? 0))

  const cappedUnrated = showAll ? neverRated : neverRated.slice(0, ENGAGEMENT_CAP)
  const lockedCount = showAll ? 0 : Math.max(0, neverRated.length - ENGAGEMENT_CAP)

  const events = [...everRated, ...cappedUnrated].sort((a, b) => a.date.localeCompare(b.date))
  return NextResponse.json({ events, lockedCount, sharingWithCount, sharedWithMeCount })
}
