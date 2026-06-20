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
}

const USER_FIELDS = [
  'Email', 'Name', 'FirstName', 'Function', 'Seniority', 'Grade',
  'Size', 'Interest', 'Employment', 'Location', 'LatLon', 'Active',
  'Frequency', 'LinkedIn', 'Learn', 'Status',
]

const EVENT_FIELDS = [
  'Name', 'Type', 'Date', 'Location', 'Description', 'Link', 'Audience',
  'LatLon', 'Submitter', 'Source', 'Host',
]

export interface SyncStats {
  upserted: number
  tombstoned: number
  durationMs: number
}

export async function syncUsersToCache(): Promise<SyncStats> {
  const start = Date.now()
  const base = getBase()
  const supabase = getSupabase()

  const records = await base('Users').select({ fields: USER_FIELDS }).all()

  const rows: UserRow[] = records.map((r) => {
    const activeRaw = String(r.get('Active') || '')
    const gradeRaw = String(r.get('Grade') || '').trim()
    const grade = gradeRaw === 'A' || gradeRaw === 'Polish' || gradeRaw === 'B' || gradeRaw === 'C'
      ? gradeRaw
      : null
    const { lat, lng } = parseLatLon(r.get('LatLon'))
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
      active: activeRaw.toLowerCase() === 'active',
      status: activeRaw,
      frequency: String(r.get('Frequency') || ''),
      linkedin: String(r.get('LinkedIn') || ''),
      learn: String(r.get('Learn') || ''),
      // Airtable Status is a distinct field from Active. Only consumer is the
      // partner-only gate (getPartnerUserByEmail), which checks exactly this.
      is_partner: String(r.get('Status') || '') === 'Partner',
      airtable_deleted_at: null,
    }
  })

  // Legacy cache shape — keep populating until Phase 2 swaps the reader.
  // Strip the new columns the cache table doesn't carry.
  const cacheRows: UserCacheRow[] = rows.map((r) => {
    const cache: UserCacheRow = {
      id: r.id,
      email: r.email,
      name: r.name,
      first_name: r.first_name,
      fn: r.fn,
      seniority: r.seniority,
      grade: r.grade,
      company_size: r.company_size,
      interest: r.interest,
      employment: r.employment,
      location: r.location,
      lat: r.lat,
      lng: r.lng,
      active: r.active,
      status: r.status,
      frequency: r.frequency,
      airtable_deleted_at: null,
    }
    return cache
  })

  // Bulk upsert in chunks. Supabase has a per-request payload limit; 500
  // rows × ~20 fields fits comfortably.
  const CHUNK = 500
  for (let i = 0; i < cacheRows.length; i += CHUNK) {
    const chunk = cacheRows.slice(i, i + CHUNK)
    const { error } = await supabase.from('users_cache').upsert(chunk, { onConflict: 'id' })
    if (error) throw new Error(`users_cache upsert failed: ${error.message}`)
  }
  // New canonical table — written in parallel with the cache. Phase 2 will
  // switch readers from Airtable / users_cache to this table.
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from('users').upsert(chunk, { onConflict: 'id' })
    if (error) throw new Error(`users upsert failed: ${error.message}`)
  }

  // Tombstone rows that exist in cache but not in the current Airtable snapshot.
  const liveIds = new Set(rows.map((r) => r.id))
  const tombstoned = await tombstoneMissing(supabase, 'users_cache', liveIds)
  await tombstoneMissing(supabase, 'users', liveIds)

  return { upserted: rows.length, tombstoned, durationMs: Date.now() - start }
}

export async function syncEventsToCache(): Promise<SyncStats> {
  const start = Date.now()
  const base = getBase()
  const supabase = getSupabase()

  const records = await base('Events').select({ fields: EVENT_FIELDS }).all()

  const rows: EventRow[] = records.map((r) => {
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
      // Image attachment URLs are short-lived; Phase 1 leaves the proxy path
      // alone and stores empty. A future phase will fetch + persist to
      // Supabase Storage so we can drop the Airtable read on images.
      image_url: '',
      host_ids: hostIds,
      // Existing events default to approved=true so backfill is a no-op for
      // the matching loop. The admin "remove from matching" toggle will
      // flip this to false going forward.
      approved: true,
      airtable_deleted_at: null,
    }
  })

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
