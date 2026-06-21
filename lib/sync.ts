import { createClient } from '@supabase/supabase-js'
import Airtable, { Base } from 'airtable'

// Airtable → Supabase sync. Airtable remains source of truth and CRM UI; these
// helpers populate users_cache and events_cache, which runtime code reads from
// instead of hitting Airtable directly.
//
// Rows that disappear from Airtable get tombstoned (airtable_deleted_at) rather
// than hard-deleted so we can debug accidental removals.

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function getBase(): Base {
  if (!process.env.AIRTABLE_API_KEY) throw new Error('AIRTABLE_API_KEY is not set')
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base('appK8AqOvtEgIquRT')
}

// Airtable records carry their createdTime on _rawJson. Defensive accessor
// returns null when the field is absent so callers can pick a fallback.
function airtableCreatedTime(record: unknown): string | null {
  const raw = (record as { _rawJson?: { createdTime?: unknown } })?._rawJson?.createdTime
  if (typeof raw !== 'string' || !raw) return null
  // Make sure it parses; bail if not so we don't write garbage to a timestamptz.
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}

function parseLatLon(raw: unknown): { lat: number | null; lng: number | null } {
  const s = String(raw || '').trim()
  if (!s) return { lat: null, lng: null }
  const [latStr, lngStr] = s.split(',').map((p) => p.trim())
  const lat = Number(latStr)
  const lng = Number(lngStr)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: null, lng: null }
  if (lat === 0 && lng === 0) return { lat: null, lng: null }
  return { lat, lng }
}

interface UserCacheRow {
  id: string
  email: string
  name: string
  first_name: string
  fn: string
  seniority: string
  grade: string | null
  company_size: string
  interest: string
  employment: string
  location: string
  lat: number | null
  lng: number | null
  active: boolean
  status: string
  frequency: string
  airtable_deleted_at: null
}

// Phase 1 of the Airtable -> Supabase migration: real users row carries every
// column users_cache has plus the fields the cache was missing (linkedin,
// learn). Phase 2 adds is_partner (derived from Airtable's Status field).
// first_activated_at is INTENTIONALLY not part of this shape — it's
// maintained by a Postgres trigger + the migration backfill, so omitting it
// from the upsert payload preserves the existing value across syncs.
interface UserRow extends UserCacheRow {
  linkedin: string
  learn: string
  is_partner: boolean
  // Airtable record createdTime (when the row was first created in Airtable).
  // Mirrored so AirtableUser.created surfaces real history and the activation
  // backfill can use it as the actual "first activated at" approximation.
  airtable_created_at: string
}

interface EventCacheRow {
  id: string
  name: string
  type: string
  date: string
  location: string
  description: string
  link: string
  audience: string[]
  lat: number | null
  lng: number | null
  airtable_deleted_at: null
}

// Phase 1 of the migration: real events row adds host_ids / submitter_email /
// source / image_url / approved (the fields the cache shape never carried
// because no reader needed them).
interface EventRow extends Omit<EventCacheRow, 'date'> {
  date: string | null // empty Airtable cell -> NULL date column
  submitter_email: string
  source: string
  image_url: string
  host_ids: string[]
  approved: boolean
  featured: boolean
  airtable_created_at: string
}

const USER_FIELDS = [
  'Email', 'Name', 'FirstName', 'Function', 'Seniority', 'Grade',
  'Size', 'Interest', 'Employment', 'Location', 'LatLon', 'Active',
  'Frequency', 'LinkedIn', 'Learn', 'Status',
]

const EVENT_FIELDS = [
  'Name', 'Type', 'Date', 'Location', 'Description', 'Link', 'Audience',
  'LatLon', 'Submitter', 'Source', 'Host', 'Image', 'Feature',
]

export interface SyncStats {
  upserted: number
  tombstoned: number
  durationMs: number
}

export async function syncUsersToCache(): Promise<SyncStats> {
  // Users are no longer synced from Airtable — Supabase is the canonical
  // store. All write paths (signup, admin edit, profile edit) target the
  // users table directly via lib/airtable.ts. Kept exported so the cron +
  // admin sync endpoints can call it without conditional logic; returns an
  // empty stats shape so existing response bodies stay valid.
  return { upserted: 0, tombstoned: 0, durationMs: 0 }
}

export async function syncEventsToCache(): Promise<SyncStats> {
  const start = Date.now()
  const base = getBase()
  const supabase = getSupabase()

  const records = await base('Events').select({ fields: EVENT_FIELDS }).all()

  const rows: EventRow[] = records.map(eventRecordToRow)

  // Legacy cache shape — keep populating until Phase 2 swaps the reader.
  const cacheRows: EventCacheRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    date: r.date ?? '',
    location: r.location,
    description: r.description,
    link: r.link,
    audience: r.audience,
    lat: r.lat,
    lng: r.lng,
    airtable_deleted_at: null,
  }))

  const CHUNK = 500
  for (let i = 0; i < cacheRows.length; i += CHUNK) {
    const chunk = cacheRows.slice(i, i + CHUNK)
    const { error } = await supabase.from('events_cache').upsert(chunk, { onConflict: 'id' })
    if (error) throw new Error(`events_cache upsert failed: ${error.message}`)
  }
  // New canonical table.
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from('events').upsert(chunk, { onConflict: 'id' })
    if (error) throw new Error(`events upsert failed: ${error.message}`)
  }

  const liveIds = new Set(rows.map((r) => r.id))
  const tombstoned = await tombstoneMissing(supabase, 'events_cache', liveIds)
  await tombstoneMissing(supabase, 'events', liveIds)

  // Persist each event's image into Supabase Storage and stamp events.image_url
  // with the public URL. Sequential — image-fetch + upload is ~200-500 ms per
  // event and the volume is tiny, so the simpler serial loop wins over juggling
  // concurrency. Failures don't abort the sync; the proxy's Airtable fallback
  // continues to cover any row whose image_url is still empty.
  for (const record of records) {
    await uploadEventImageIfPresent(record.id, record as AirtableRecord, supabase)
  }

  return { upserted: rows.length, tombstoned, durationMs: Date.now() - start }
}

async function tombstoneMissing(
  supabase: ReturnType<typeof getSupabase>,
  table: 'users_cache' | 'events_cache' | 'users' | 'events',
  liveIds: Set<string>,
): Promise<number> {
  // Fetch current ids that aren't already tombstoned. Anything missing from
  // liveIds gets airtable_deleted_at stamped.
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .is('airtable_deleted_at', null)
  if (error) {
    console.error(`tombstoneMissing(${table}) select failed:`, error)
    return 0
  }

  const toTombstone = (data ?? [])
    .map((r) => (r as { id: string }).id)
    .filter((id) => !liveIds.has(id))

  if (!toTombstone.length) return 0

  const nowIso = new Date().toISOString()
  // Update in chunks to keep payload sizes reasonable.
  const CHUNK = 500
  for (let i = 0; i < toTombstone.length; i += CHUNK) {
    const chunk = toTombstone.slice(i, i + CHUNK)
    const { error: updateErr } = await supabase
      .from(table)
      .update({ airtable_deleted_at: nowIso })
      .in('id', chunk)
    if (updateErr) {
      console.error(`tombstoneMissing(${table}) update failed:`, updateErr)
    }
  }
  return toTombstone.length
}

// Row builders shared between the full-table syncs and the single-row helpers
// below. Keeping the mapping in one place means the matching-loop hot path
// (which re-pulls one row from Airtable when Supabase hasn't synced yet) and
// the cron-driven full sync write identical row shapes.

type AirtableRecord = {
  id: string
  get: (field: string) => unknown
  _rawJson?: { createdTime?: string }
}

// Canonical lifecycle picklist. Empty Airtable Status -> Pending so signups
// land in the "to approve" bucket automatically. Anything outside the enum
// (legacy values like "Inactive") passes through to the status column as-is
// but the user isn't active.
const VALID_STATUSES = ['Pending', 'Live', 'Passed', 'Deactivated', 'Partner']

function userRecordToRow(r: AirtableRecord): UserRow {
  const gradeRaw = String(r.get('Grade') || '').trim()
  const grade = gradeRaw === 'A' || gradeRaw === 'Polish' || gradeRaw === 'B' || gradeRaw === 'C'
    ? gradeRaw
    : null
  const { lat, lng } = parseLatLon(r.get('LatLon'))

  // Status is the canonical lifecycle picklist; Active is the deprecated
  // legacy text field. Priority during the backfill cutover:
  //   1. Status field holds a canonical picklist value → trust it.
  //   2. Else Active="active" → derive "Live". Legacy Active signal wins
  //      over any non-canonical Status text so existing live users don't
  //      get demoted if their Status cell holds stray legacy data.
  //   3. Else preserve raw Status text → treat as inactive but visible in
  //      admin (status passes through for debugging).
  //   4. Else (no signal at all) → "Pending" (default for new signups).
  // Once Airtable Status is fully backfilled, rules 2-3 are unreachable.
  const statusRaw = String(r.get('Status') || '').trim()
  const activeRaw = String(r.get('Active') || '').toLowerCase().trim()
  let status: string
  if (VALID_STATUSES.includes(statusRaw)) {
    status = statusRaw
  } else if (activeRaw === 'active') {
    status = 'Live'
  } else if (statusRaw) {
    status = statusRaw
  } else {
    status = 'Pending'
  }
  const active = status === 'Live' || status === 'Partner'

  return {
    id: r.id,
    email: String(r.get('Email') || ''),
    name: String(r.get('Name') || ''),
    first_name: String(r.get('FirstName') || ''),
    fn: String(r.get('Function') || ''),
    seniority: String(r.get('Seniority') || ''),
    grade,
    company_size: String(r.get('Size') || ''),
    interest: String(r.get('Interest') || ''),
    employment: String(r.get('Employment') || ''),
    location: String(r.get('Location') || ''),
    lat,
    lng,
    active,
    status,
    frequency: String(r.get('Frequency') || ''),
    linkedin: String(r.get('LinkedIn') || ''),
    learn: String(r.get('Learn') || ''),
    // is_partner derived from the same Status picklist now. Partner users are
    // also active for the matching loop.
    is_partner: status === 'Partner',
    // Airtable record createdTime — the closest signal we have to "when
    // did this user originally exist". The Airtable JS client exposes it
    // on the private _rawJson; defensively fall back to now() if absent.
    airtable_created_at:
      airtableCreatedTime(r) ?? new Date().toISOString(),
    airtable_deleted_at: null,
  }
}

function eventRecordToRow(r: AirtableRecord): EventRow {
  const { lat, lng } = parseLatLon(r.get('LatLon'))
  const dateRaw = String(r.get('Date') || '').trim()
  const hostIds = (r.get('Host') as string[] | undefined) ?? []
  return {
    id: r.id,
    name: String(r.get('Name') || ''),
    type: String(r.get('Type') || ''),
    // Empty Airtable date -> NULL on the events table (date column rejects '').
    date: dateRaw || null,
    location: String(r.get('Location') || ''),
    description: String(r.get('Description') || ''),
    link: String(r.get('Link') || ''),
    audience: String(r.get('Audience') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    lat,
    lng,
    submitter_email: String(r.get('Submitter') || ''),
    source: String(r.get('Source') || ''),
    // image_url is populated by uploadEventImageIfPresent after the row
    // upsert. Default to empty so freshly-created rows have a defined value
    // until the upload step lands; the proxy at /api/event-image/[id] falls
    // back to Airtable for any event whose image_url is still empty.
    image_url: '',
    host_ids: hostIds,
    // Existing events default to approved=true so backfill is a no-op for
    // the matching loop. The admin "remove from matching" toggle will
    // flip this to false going forward.
    approved: true,
    // Airtable Feature checkbox (singular — the actual field name)
    // -> Supabase events.featured. Drives the public homepage carousel
    // via lib/events.ts:getFeaturedEvents.
    featured: r.get('Feature') === true,
    airtable_created_at:
      airtableCreatedTime(r) ?? new Date().toISOString(),
    airtable_deleted_at: null,
  }
}

const EVENT_IMAGES_BUCKET = 'event-images'

// Persists an event's Airtable Image attachment into Supabase Storage and
// updates events.image_url with the public bucket URL. Idempotent — overwrites
// any existing object under the same key. Returns the public URL on success,
// '' when the event has no image, and null on failure (caller logs and moves
// on; the proxy still falls back to Airtable for any row whose image_url is
// still empty).
//
// Called from both syncSingleEvent and the bulk sync loop after the row
// upsert. We do the bytes work post-upsert so a Storage hiccup never blocks
// the row from landing in Supabase.
async function uploadEventImageIfPresent(
  eventId: string,
  record: AirtableRecord,
  supabase: ReturnType<typeof getSupabase>,
): Promise<string | null> {
  const image = record.get('Image') as
    | Array<{
        url: string
        type?: string
        thumbnails?: { large?: { url?: string }; small?: { url?: string } }
      }>
    | undefined
  // Prefer Airtable's resized large thumbnail (JPEG-encoded, smaller payload)
  // and fall back to the original upload. Mirrors the proxy's selection.
  const url = image?.[0]?.thumbnails?.large?.url || image?.[0]?.url
  if (!url) return ''

  const upstream = await fetch(url)
  if (!upstream.ok) {
    console.error(`uploadEventImageIfPresent(${eventId}): upstream ${upstream.status}`)
    return null
  }
  const bytes = await upstream.arrayBuffer()
  const contentType =
    upstream.headers.get('content-type') || image?.[0]?.type || 'image/jpeg'

  const key = `${eventId}.jpg`
  const { error: uploadErr } = await supabase.storage
    .from(EVENT_IMAGES_BUCKET)
    .upload(key, bytes, { contentType, upsert: true })
  if (uploadErr) {
    console.error(`uploadEventImageIfPresent(${eventId}) upload failed:`, uploadErr)
    return null
  }

  const { data } = supabase.storage.from(EVENT_IMAGES_BUCKET).getPublicUrl(key)
  const publicUrl = data?.publicUrl ?? ''
  if (!publicUrl) {
    console.error(`uploadEventImageIfPresent(${eventId}): getPublicUrl returned empty`)
    return null
  }

  const { error: updateErr } = await supabase
    .from('events')
    .update({ image_url: publicUrl })
    .eq('id', eventId)
  if (updateErr) {
    console.error(`uploadEventImageIfPresent(${eventId}) image_url update failed:`, updateErr)
    return null
  }
  return publicUrl
}

// Single-row sync used by the matching loop's event/user triggers. The
// cron sync runs frequently but not instantaneously, and a brand-new
// event submission immediately fires /api/process-matches before the
// next cron tick — so the trigger entry pulls just this row from
// Airtable and upserts to Supabase to keep the read fresh.
//
// Returns true on a successful single-row sync, false if the record
// doesn't exist in Airtable (or the upsert failed). Callers treat
// false as "row truly absent" and bail accordingly.
export async function syncSingleUser(userId: string): Promise<boolean> {
  // Single-user sync no longer needed — Supabase is canonical and every
  // write path updates it directly. Kept as a no-op so legacy callers
  // (e.g. lib/airtable.ts:mirrorUserSafe) compile and don't fan out an
  // unnecessary Airtable fetch on every admin save.
  return Boolean(userId)
}

export async function syncSingleEvent(eventId: string): Promise<boolean> {
  if (!eventId) return false
  const base = getBase()
  const supabase = getSupabase()
  try {
    const record = await base('Events').find(eventId)
    const row = eventRecordToRow(record as AirtableRecord)
    const { error } = await supabase.from('events').upsert(row, { onConflict: 'id' })
    if (error) {
      console.error(`syncSingleEvent(${eventId}) upsert failed:`, error)
      return false
    }
    // Non-fatal: log and continue if the image upload trips. The row landed,
    // and the proxy falls back to Airtable for events whose image_url is
    // still empty.
    await uploadEventImageIfPresent(eventId, record as AirtableRecord, supabase)
    return true
  } catch (err) {
    console.error(`syncSingleEvent(${eventId}) failed:`, err)
    return false
  }
}
