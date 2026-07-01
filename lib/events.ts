// Phase 2 of the Airtable -> Supabase migration: Supabase-backed event reads.
//
// Public API mirrors the read surface of lib/airtable.ts (every function name
// that today reads Events from Airtable) so call sites swap one import line.
// Return shape is the existing AirtableEvent / DuplicateCheckResult — same
// downstream consumers, different storage backend.

import { createClient } from '@supabase/supabase-js'
import stringSimilarity from 'string-similarity'
import { AirtableEvent, DuplicateCheckResult, FeaturedEvent, cleanEventLink } from './airtable'
import { EventRecord } from './types'

export type { AirtableEvent, DuplicateCheckResult, FeaturedEvent }

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// Shape of the row coming back from public.events. Kept private; callers
// see AirtableEvent. status is the lifecycle gate (added in
// 20260622180000_event_status.sql); the legacy approved boolean was dropped
// in 20260622200000_drop_event_approved.sql.
interface EventRow {
  id: string
  name: string
  type: string | null
  date: string | null
  location: string | null
  description: string | null
  link: string | null
  audience: string[] | null
  lat: string | number | null
  lng: string | number | null
  submitter_email: string | null
  source: string | null
  image_url: string | null
  host_ids: string[] | null
  status: string | null
  featured: boolean
  airtable_created_at: string | null
  airtable_deleted_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  invite_employment: string[] | null
  invite_company_size: string[] | null
  invite_seniority: string[] | null
}

function toAirtableEvent(row: EventRow): AirtableEvent {
  const lat = row.lat == null ? undefined : Number(row.lat)
  const lng = row.lng == null ? undefined : Number(row.lng)
  return {
    id: row.id,
    name: row.name ?? '',
    type: row.type ?? '',
    date: row.date ?? '',
    location: row.location ?? '',
    description: row.description ?? '',
    link: row.link ?? '',
    audience: row.audience ?? [],
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    // Prefer the Airtable createdTime so callers see real history;
    // created_at (Supabase insert time) is meaningless post-Phase-1.
    created: row.airtable_created_at ?? row.created_at ?? '',
    featured: row.featured === true,
    status: row.status ?? 'Pending',
    hostIds: row.host_ids ?? [],
    inviteEmployment: row.invite_employment ?? [],
    inviteCompanySize: row.invite_company_size ?? [],
    inviteSeniority: row.invite_seniority ?? [],
  }
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0]
}

export async function getEventsCount(): Promise<number> {
  const supabase = getSupabase()
  const { count, error } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .gte('date', todayIso())
    .eq('status', 'Live')
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
  if (error) {
    console.error('getEventsCount error', error)
    return 0
  }
  return count ?? 0
}

// Every future, Live, non-deleted event. Matching-loop scope and the read
// for every public event surface (dashboard, digest, etc.). Pending and
// Deactivated events drop out so admin gating is the canonical filter.
export async function getFutureEvents(): Promise<AirtableEvent[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .gte('date', todayIso())
    .eq('status', 'Live')
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
  if (error) {
    console.error('getFutureEvents error', error)
    return []
  }
  return (data ?? []).map((row) => toAirtableEvent(row as EventRow)).filter((e) => e.name)
}

export async function getEventById(eventId: string): Promise<AirtableEvent | null> {
  if (!eventId) return null
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle()
  if (error) {
    console.error('getEventById error', { eventId, error })
    return null
  }
  return data ? toAirtableEvent(data as EventRow) : null
}

// Homepage carousel source. Strict criteria: must be flagged featured in
// Airtable (mirrored into events.featured), must have a Storage-backed image
// (image_url populated by Phase A's upload step), and must already have
// happened. Past-event + image requirement matches what the homepage actually
// surfaces today; the date < today guard prevents the carousel from
// previewing future events that don't yet have social proof.
export async function getFeaturedEvents(): Promise<FeaturedEvent[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('events')
    .select('id, name, description, link, date, location, image_url')
    .eq('featured', true)
    .eq('status', 'Live')
    .neq('image_url', '')
    .lt('date', todayIso())
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
    .order('date', { ascending: false })
    .limit(10)
  if (error) {
    console.error('getFeaturedEvents error', error)
    return []
  }
  return (data ?? [])
    .map((row) => {
      const r = row as Pick<EventRow, 'id' | 'name' | 'description' | 'link' | 'date' | 'location' | 'image_url'>
      return {
        id: r.id,
        name: r.name ?? '',
        description: r.description ?? '',
        link: r.link ?? '',
        date: r.date ?? '',
        location: r.location ?? '',
        // image_url filter above already guarantees a usable image; route
        // through the existing proxy so the carousel URL stays stable even
        // if we move buckets later.
        imageUrl: `/api/event-image/${r.id}`,
      }
    })
    .filter((e) => e.name)
}

export type EventScope = 'future' | 'past' | 'all'
export type FeaturedFilter = 'all' | 'yes' | 'no'

// Admin events list reader. Mirrors getFutureEvents' shape but accepts a date
// scope and featured filter so the list page can show past + featured rows.
// Admin events list. statusBucket controls the lifecycle filter:
//   live (default)  status = 'Live'      matches the rest of the app
//   toApprove        status = 'Pending'   admin triage queue
//   deactivated      status = 'Deactivated'
//   all              no status filter — every event regardless of lifecycle
export type EventStatusBucket = 'live' | 'toApprove' | 'deactivated' | 'all'

export async function getEventsForAdmin(opts: {
  scope?: EventScope
  featured?: FeaturedFilter
  statusBucket?: EventStatusBucket
}): Promise<AirtableEvent[]> {
  const { scope = 'future', featured = 'all', statusBucket = 'live' } = opts
  const supabase = getSupabase()
  let q = supabase
    .from('events')
    .select('*')
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
  if (statusBucket === 'live') q = q.eq('status', 'Live')
  else if (statusBucket === 'toApprove') q = q.eq('status', 'Pending')
  else if (statusBucket === 'deactivated') q = q.eq('status', 'Deactivated')
  const today = todayIso()
  if (scope === 'future') q = q.gte('date', today)
  else if (scope === 'past') q = q.lt('date', today)
  if (featured === 'yes') q = q.eq('featured', true)
  else if (featured === 'no') q = q.eq('featured', false)
  const { data, error } = await q
  if (error) {
    console.error('getEventsForAdmin error', { opts, error })
    return []
  }
  return (data ?? []).map((row) => toAirtableEvent(row as EventRow)).filter((e) => e.name)
}

// Returns the row's featured flag without ferrying the entire event shape.
// Admin GET on /api/admin/events/[id] uses this alongside the existing
// image_url select to avoid a wider SELECT *.
// Set of every user id that hosts at least one future, approved, non-deleted
// event. Used by the admin user list to flag hosts with a star next to
// their name. One round-trip + a flatten, called once per dashboard refresh.
export async function getFutureEventHostIds(): Promise<Set<string>> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('events')
    .select('host_ids')
    .gte('date', todayIso())
    .eq('status', 'Live')
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
  if (error) {
    console.error('getFutureEventHostIds error', error)
    return new Set()
  }
  const ids = new Set<string>()
  for (const row of data ?? []) {
    const hostIds = (row as { host_ids: string[] | null }).host_ids ?? []
    for (const id of hostIds) if (id) ids.add(id)
  }
  return ids
}

export async function getEventFlags(eventId: string): Promise<{
  image_url: string
  featured: boolean
  host_ids: string[]
  status: string
  submitter_email: string
} | null> {
  if (!eventId) return null
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('events')
    .select('image_url, featured, host_ids, status, submitter_email')
    .eq('id', eventId)
    .maybeSingle()
  if (error) {
    console.error('getEventFlags error', { eventId, error })
    return null
  }
  if (!data) return null
  const row = data as {
    image_url: string | null
    featured: boolean | null
    host_ids: string[] | null
    status: string | null
    submitter_email: string | null
  }
  return {
    image_url: row.image_url ?? '',
    featured: row.featured === true,
    host_ids: row.host_ids ?? [],
    status: row.status ?? 'Pending',
    submitter_email: row.submitter_email ?? '',
  }
}

// Auth-gated event fetch — returns null unless the userId is in host_ids.
// Used by /api/host/events/[id] GET/PATCH so non-hosts can't read.
export async function getEventByIdIfHost(
  eventId: string,
  userId: string,
): Promise<AirtableEvent | null> {
  if (!eventId || !userId) return null
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle()
  if (error) {
    console.error('getEventByIdIfHost error', { eventId, userId, error })
    return null
  }
  if (!data) return null
  const row = data as EventRow
  if (!(row.host_ids ?? []).includes(userId)) return null
  return toAirtableEvent(row)
}

export async function getEventsHostedBy(userId: string): Promise<AirtableEvent[]> {
  if (!userId) return []
  const supabase = getSupabase()
  // `contains` on a text[] column compiles to `host_ids @> ARRAY['userId']`,
  // hitting the GIN index added in Phase 1.
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .contains('host_ids', [userId])
    .gte('date', todayIso())
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
  if (error) {
    console.error('getEventsHostedBy error', { userId, error })
    return []
  }
  return (data ?? []).map((row) => toAirtableEvent(row as EventRow))
}

// Lowercased emails of every user listed in the event's host_ids array. Used
// by /api/check-event to decide whether a duplicate submitter is already a
// host (re-submitting their own event is a no-op rather than an offer to
// claim co-host).
export async function getEventHostEmails(eventId: string): Promise<string[]> {
  if (!eventId) return []
  const supabase = getSupabase()
  const { data: eventData, error: eventErr } = await supabase
    .from('events')
    .select('host_ids')
    .eq('id', eventId)
    .maybeSingle()
  if (eventErr || !eventData) {
    if (eventErr) console.error('getEventHostEmails event error', { eventId, eventErr })
    return []
  }
  const hostIds = (eventData as { host_ids: string[] | null }).host_ids ?? []
  if (!hostIds.length) return []
  const { data: userRows, error: userErr } = await supabase
    .from('users')
    .select('email')
    .in('id', hostIds)
  if (userErr) {
    console.error('getEventHostEmails users error', { eventId, userErr })
    return []
  }
  return (userRows ?? [])
    .map((r) => String((r as { email: string }).email || '').toLowerCase())
    .filter(Boolean)
}

// Defense-in-depth dedupe: exact link match wins; otherwise fuzzy-name +
// date check against events from the last 30 days through any future date.
// Mirrors the Airtable implementation 1:1 — same thresholds, same windowing,
// same returned shape.
export async function checkDuplicate(
  name: string,
  link: string,
  date?: string,
): Promise<DuplicateCheckResult> {
  const supabase = getSupabase()

  // 1) Exact link match shortcut. Clean tracking params first so a UTM-tagged
  //    copy still matches the canonical stored URL.
  const cleanedLink = cleanEventLink(link)
  if (cleanedLink) {
    const { data, error } = await supabase
      .from('events')
      .select('id, name, link, date, location, description, audience, type')
      .eq('link', cleanedLink)
      .is('airtable_deleted_at', null)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle()
    if (error) console.error('checkDuplicate link match error', error)
    if (data) return buildDuplicateResult(data as DupRow)
  }

  // 2) Fuzzy name match against recent + future events. Skipping archived
  //    events keeps the candidate pool small — historically the main cost
  //    here was scoring stringSimilarity over the full corpus.
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]
  const { data: candidates, error } = await supabase
    .from('events')
    .select('id, name, link, date, location, description, audience, type')
    .gte('date', cutoff)
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
  if (error) {
    console.error('checkDuplicate fuzzy match error', error)
    return { isDuplicate: false }
  }
  for (const row of (candidates ?? []) as DupRow[]) {
    const existingName = row.name || ''
    const nameSimilarity = existingName
      ? stringSimilarity.compareTwoStrings(name.toLowerCase(), existingName.toLowerCase())
      : 0
    const nameMatch = nameSimilarity > 0.7
    const dateMatch = !!(date && row.date === date)
    if ((nameMatch && dateMatch) || nameSimilarity > 0.9) {
      return buildDuplicateResult(row)
    }
  }
  return { isDuplicate: false }
}

// Subset of EventRow used by checkDuplicate's projected SELECT.
interface DupRow {
  id: string
  name: string | null
  link: string | null
  date: string | null
  location: string | null
  description: string | null
  audience: string[] | null
  type: string | null
}

function buildDuplicateResult(row: DupRow): DuplicateCheckResult {
  const missingFields: string[] = []
  if (!row.description) missingFields.push('description')
  if (!row.audience || row.audience.length === 0) missingFields.push('audience')
  if (!row.type) missingFields.push('type')
  if (!row.date) missingFields.push('date')
  if (!row.location) missingFields.push('location')
  return {
    isDuplicate: true,
    existingId: row.id,
    existingRecord: {
      name: row.name ?? '',
      link: row.link ?? '',
      date: row.date ?? '',
      location: row.location ?? '',
      description: row.description ?? '',
      type: (row.type as EventRecord['type']) || 'Other',
      audience: row.audience ?? [],
    },
    missingFields,
  }
}
