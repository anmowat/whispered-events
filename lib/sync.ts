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
  full_exp: string
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

const USER_FIELDS = [
  'Email', 'Name', 'FirstName', 'Function', 'Seniority', 'FullExp', 'Grade',
  'Size', 'Interest', 'Employment', 'Location', 'LatLon', 'Active',
  'Frequency',
]

const EVENT_FIELDS = [
  'Name', 'Type', 'Date', 'Location', 'Description', 'Link', 'Audience', 'LatLon',
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

  const rows: UserCacheRow[] = records.map((r) => {
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
      full_exp: String(r.get('FullExp') || ''),
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
      airtable_deleted_at: null,
    }
  })

  // Bulk upsert in chunks. Supabase has a per-request payload limit; 500
  // rows × ~20 fields fits comfortably.
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from('users_cache').upsert(chunk, { onConflict: 'id' })
    if (error) throw new Error(`users_cache upsert failed: ${error.message}`)
  }

  // Tombstone rows that exist in cache but not in the current Airtable snapshot.
  const liveIds = new Set(rows.map((r) => r.id))
  const tombstoned = await tombstoneMissing(supabase, 'users_cache', liveIds)

  return { upserted: rows.length, tombstoned, durationMs: Date.now() - start }
}

export async function syncEventsToCache(): Promise<SyncStats> {
  const start = Date.now()
  const base = getBase()
  const supabase = getSupabase()

  const records = await base('Events').select({ fields: EVENT_FIELDS }).all()

  const rows: EventCacheRow[] = records.map((r) => {
    const { lat, lng } = parseLatLon(r.get('LatLon'))
    return {
      id: r.id,
      name: String(r.get('Name') || ''),
      type: String(r.get('Type') || ''),
      date: String(r.get('Date') || ''),
      location: String(r.get('Location') || ''),
      description: String(r.get('Description') || ''),
      link: String(r.get('Link') || ''),
      audience: String(r.get('Audience') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      lat,
      lng,
      airtable_deleted_at: null,
    }
  })

  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from('events_cache').upsert(chunk, { onConflict: 'id' })
    if (error) throw new Error(`events_cache upsert failed: ${error.message}`)
  }

  const liveIds = new Set(rows.map((r) => r.id))
  const tombstoned = await tombstoneMissing(supabase, 'events_cache', liveIds)

  return { upserted: rows.length, tombstoned, durationMs: Date.now() - start }
}

async function tombstoneMissing(
  supabase: ReturnType<typeof getSupabase>,
  table: 'users_cache' | 'events_cache',
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
