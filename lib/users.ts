// Phase 2 of the Airtable -> Supabase migration: Supabase-backed user reads.
//
// Public API mirrors the read surface of lib/airtable.ts exactly, so call
// sites swap one import line and nothing else. Return shape is the existing
// AirtableUser type (re-exported here for ergonomics) — the data still flows
// through the same downstream code, it just sourced from a different layer.

import { createClient } from '@supabase/supabase-js'
import { AirtableUser } from './airtable'

export type { AirtableUser }

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// Shape of the row coming back from public.users. Mirrors the columns the
// sync writes in lib/sync.ts plus the Phase 2 additions (is_partner,
// first_activated_at). Kept private to this module — callers always see the
// AirtableUser shape regardless of storage backend.
interface UserRow {
  id: string
  email: string
  name: string | null
  first_name: string | null
  fn: string | null
  seniority: string | null
  grade: string | null
  company_size: string | null
  interest: string | null
  employment: string | null
  location: string | null
  lat: string | number | null
  lng: string | number | null
  active: boolean
  status: string | null
  frequency: string | null
  linkedin: string | null
  learn: string | null
  is_partner: boolean
  first_activated_at: string | null
  // Airtable record createdTime — the real "when did this user originally
  // sign up" signal. created_at below is when the Supabase mirror first
  // inserted the row (~today for everyone, post-Phase 1).
  airtable_created_at: string | null
  airtable_deleted_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

function toAirtableUser(row: UserRow): AirtableUser {
  const grade = row.grade === 'A' || row.grade === 'Polish' || row.grade === 'B' || row.grade === 'C'
    ? (row.grade as 'A' | 'Polish' | 'B' | 'C')
    : undefined
  // numeric columns come back as strings from supabase-js in some configs;
  // coerce defensively.
  const lat = row.lat == null ? undefined : Number(row.lat)
  const lng = row.lng == null ? undefined : Number(row.lng)
  return {
    id: row.id,
    // Prefer the Airtable createdTime so callers see real history;
    // created_at (Supabase insert time) is meaningless post-Phase-1.
    created: row.airtable_created_at ?? row.created_at ?? '',
    email: row.email ?? '',
    name: row.name ?? '',
    firstName: row.first_name ?? '',
    function: row.fn ?? '',
    seniority: row.seniority ?? '',
    grade,
    companySize: row.company_size ?? '',
    interest: row.interest ?? '',
    employment: row.employment ?? '',
    location: row.location ?? '',
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    active: !!row.active,
    status: row.status ?? '',
    frequency: row.frequency ?? '',
    linkedin: row.linkedin ?? '',
    learn: row.learn ?? '',
  }
}

// Soft-delete predicate: applied to every read so rows the sync tombstoned
// (upstream Airtable removal) or the admin disabled (deleted_at) don't leak.

export async function getUserByEmail(email: string): Promise<AirtableUser | null> {
  const trimmed = (email || '').trim()
  if (!trimmed) return null
  const supabase = getSupabase()
  // ILIKE without wildcards is a case-insensitive exact match — mirrors
  // today's `LOWER({Email}) = '...'` Airtable formula behavior.
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('email', trimmed)
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('getUserByEmail error', { email: trimmed, error })
    return null
  }
  return data ? toAirtableUser(data as UserRow) : null
}

export async function getUserById(userId: string): Promise<AirtableUser | null> {
  if (!userId) return null
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('getUserById error', { userId, error })
    return null
  }
  return data ? toAirtableUser(data as UserRow) : null
}

// Name-prefix search for the admin host-add typeahead. Case-insensitive,
// matches against both name and first_name. Excludes tombstoned rows.
// Caller is admin-gated, so we don't worry about exposing emails here.
export async function searchUsersByName(
  query: string,
  limit = 10,
): Promise<AirtableUser[]> {
  const q = query.trim()
  if (!q) return []
  const supabase = getSupabase()
  // ilike with %pattern% gives substring match (case-insensitive). `or` ANDs
  // the soft-delete filters with the union of name / first_name / email
  // matches so the typeahead also handles users searched by their first
  // typed characters of an email.
  const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .or(`name.ilike.${pattern},first_name.ilike.${pattern},email.ilike.${pattern}`)
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
    .limit(limit)
  if (error) {
    console.error('searchUsersByName error', { query: q, error })
    return []
  }
  return (data ?? [])
    .map((row) => toAirtableUser(row as UserRow))
    .filter((u) => u.email)
}

// Bulk fetch by id. Used by the admin event detail page to resolve
// host_ids -> {name, email} for display. Preserves the input order so
// callers can rely on the array shape (deduped + missing-id-filtered).
export async function getUsersByIds(ids: string[]): Promise<AirtableUser[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (unique.length === 0) return []
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .in('id', unique)
  if (error) {
    console.error('getUsersByIds error', { ids: unique, error })
    return []
  }
  const byId = new Map<string, AirtableUser>(
    (data ?? []).map((row) => [
      (row as UserRow).id,
      toAirtableUser(row as UserRow),
    ]),
  )
  return unique
    .map((id) => byId.get(id))
    .filter((u): u is AirtableUser => Boolean(u))
}

// All active, non-deleted users. Matching loop scope. The matching code
// already filters out users with missing Grade/Function/Seniority downstream
// (via isMatchEligible), so we don't pre-filter on those here — the contract
// stays "every active user, callers decide what to do with them" which is
// what the Airtable version returned today.
export async function getActiveUsers(): Promise<AirtableUser[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('active', true)
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
  if (error) {
    console.error('getActiveUsers error', error)
    return []
  }
  return (data ?? []).map((row) => toAirtableUser(row as UserRow)).filter((u) => u.email)
}

// Admin users list reader. Mirrors getEventsForAdmin from Phase E — accepts
// a status bucket and translates it into the right SQL predicate. Live =
// matching-loop scope (Live + Partner statuses); toApprove = Pending;
// deactivated = Passed + Deactivated; all = no status filter (still respects
// soft-deletes). Default is 'live' so the admin dashboard's existing behavior
// (active users only) carries over unchanged.
export type StatusBucket = 'live' | 'toApprove' | 'deactivated' | 'all'

export async function getUsersForAdmin(opts: {
  statusBucket?: StatusBucket
}): Promise<AirtableUser[]> {
  const { statusBucket = 'live' } = opts
  const supabase = getSupabase()
  let q = supabase
    .from('users')
    .select('*')
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
  // Predicates intentionally lean on the canonical `active` boolean rather
  // than string-matching the status picklist. The Phase H sync derivation
  // is already responsible for setting active=true iff status in
  // (Live, Partner) — keeping the SQL on active aligns this with the
  // matching loop exactly, and gracefully handles legacy rows where the
  // status column still holds the pre-Phase-H raw "Active" text (those
  // rows have active=true from the original sync, and would otherwise be
  // excluded by an IN ('Live', 'Partner') string match).
  if (statusBucket === 'live') {
    q = q.eq('active', true)
  } else if (statusBucket === 'toApprove') {
    // Anyone not yet active and not explicitly rejected/churned. Catches
    // 'Pending' and legacy empty / unknown status values.
    q = q.eq('active', false).not('status', 'in', '("Passed","Deactivated")')
  } else if (statusBucket === 'deactivated') {
    q = q.in('status', ['Passed', 'Deactivated'])
  }
  const { data, error } = await q
  if (error) {
    console.error('getUsersForAdmin error', { opts, error })
    return []
  }
  return (data ?? []).map((row) => toAirtableUser(row as UserRow)).filter((u) => u.email)
}

export async function getPartnerUserByEmail(email: string): Promise<AirtableUser | null> {
  const trimmed = (email || '').trim()
  if (!trimmed) return null
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('email', trimmed)
    .eq('is_partner', true)
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('getPartnerUserByEmail error', { email: trimmed, error })
    return null
  }
  return data ? toAirtableUser(data as UserRow) : null
}
