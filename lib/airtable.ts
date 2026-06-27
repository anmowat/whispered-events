import Airtable, { FieldSet, Base } from 'airtable'
import { createClient } from '@supabase/supabase-js'
import { waitUntil } from '@vercel/functions'
import { EventRecord, UserProfile } from './types'
import stringSimilarity from 'string-similarity'
import { geocodeLocation } from './geocode'
import { linkContributionsToUser } from './supabase'
import { newUserId } from './user-id'

// Supabase is canonical for both Users and Events. Airtable still receives a
// best-effort follower write on event edits so the admin's Airtable view
// stays current as a mirror. Helper centralises the supabase client init.
function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// Derived booleans from the canonical lifecycle picklist. Kept here so the
// admin write path and any future Supabase-direct write paths produce
// identical (status, active, is_partner) triples.
function deriveLifecycle(status: string): { active: boolean; is_partner: boolean } {
  return {
    active: status === 'Live' || status === 'Partner',
    is_partner: status === 'Partner',
  }
}

// First-token-of-name helper. Mirrors the Airtable formula
//   IF(FIND(" ", Name & " ") > 1, LEFT(Name, FIND(" ", Name & " ") - 1), Name)
// so freshly enriched users (where AnySite returns a full name and admin
// hasn't set FirstName yet) get a usable first_name automatically. The
// space-or-fallback shape handles single-token names ("Madonna") without
// returning an empty string.
function deriveFirstName(fullName: string): string {
  const trimmed = (fullName || '').trim()
  if (!trimmed) return ''
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx <= 0) return trimmed
  return trimmed.slice(0, spaceIdx)
}

// One-way push of an event update to Airtable. Fire-and-forget at the call
// site via waitUntil so the admin save returns fast. Errors land in
// console.error with the id + payload so manual replay is trivial; we don't
// surface them to the user because Supabase is canonical and already updated.
async function pushEventToAirtable(
  id: string,
  fields: Partial<FieldSet>,
  label: string,
): Promise<void> {
  if (!id || Object.keys(fields).length === 0) return
  try {
    const base = getBase()
    await base(EVENTS_TABLE).update(id, fields)
  } catch (err) {
    console.error(`${label}: airtable push failed`, { id, fields, err })
  }
}

const EVENTS_TABLE = 'Events'
const PROFILES_TABLE = 'Users'
const PARTNERS_TABLE = 'Partners'

function getBase(): Base {
  if (!process.env.AIRTABLE_API_KEY) {
    throw new Error('AIRTABLE_API_KEY is not set')
  }
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base('appK8AqOvtEgIquRT')
}

// Strips tracking params from a LinkedIn URL before we write it to
// Airtable. Profile / company URLs don't need any query — every param
// you see in the wild (utm_*, trk, lipi, miniProfileUrn, viewAsMember,
// midToken, etc.) is tracking that someone clicked through from an
// email or share button. Keep host + pathname only. Trailing-slash
// normalised so the same profile URL doesn't appear twice with and
// without a slash in admin views.
export function cleanLinkedinUrl(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const url = new URL(withScheme)
    const pathname = url.pathname.replace(/\/+$/, '')
    return `${url.protocol}//${url.host}${pathname}`
  } catch {
    return trimmed
  }
}

// Tracking params to drop from inbound event URLs before we store or
// dedupe. Keeps everything case-insensitive — some sources send
// UTM_SOURCE etc. Anything starting with `utm_` is removed
// unconditionally; the named entries cover the rest of the analytics
// pipelines we've seen in inbound submissions.
const EVENT_TRACKING_PARAMS = new Set([
  // HubSpot
  '_hsenc',
  '_hsmi',
  '_hsfp',
  'hsctatracking',
  // Mailchimp
  'mc_cid',
  'mc_eid',
  // Click IDs (Google / Microsoft / Meta / LinkedIn / TikTok / X)
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'twclid',
  'li_fat_id',
  'igshid',
  'ttclid',
  'wbraid',
  'gbraid',
  // Marketo
  'mkt_tok',
  // Luma share/invite key
  'isk',
  // Vero
  'vero_id',
  'vero_conv',
  // Eventbrite affiliate / referral
  'aff',
  'eshowcase',
  // Generic referral wrappers
  'ref_src',
  'ref_url',
  'oref',
])

// Strip analytics tracking parameters from an inbound event URL.
// Applied at both the duplicate-check boundary (so different tracked
// copies of the same link match) and at create time (so the stored URL
// is the canonical, share-clean version). Returns the input untouched
// when it isn't a parseable URL.
export function cleanEventLink(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return trimmed
  }
  const params = url.searchParams
  const toRemove: string[] = []
  for (const key of Array.from(params.keys())) {
    const lower = key.toLowerCase()
    if (lower.startsWith('utm_') || EVENT_TRACKING_PARAMS.has(lower)) {
      toRemove.push(key)
    }
  }
  toRemove.forEach((k) => params.delete(k))
  // URL.toString() drops the trailing '?' automatically when no params
  // remain — handy for canonical equality on the dedupe path.
  return url.toString()
}

// Every read now goes to Supabase via lib/users.ts and lib/events.ts. The
// fallback getActiveUsers / getFutureEvents Airtable readers below are dead
// code — kept temporarily for grep history; safe to delete in a follow-up.

export async function getEventsCount(): Promise<number> {
  const base = getBase()
  const today = new Date().toISOString().split('T')[0]
  const records = await base(EVENTS_TABLE)
    .select({
      filterByFormula: `AND({Date} >= '${today}', {Date} != '')`,
      fields: ['Name'],
    })
    .all()
  return records.length
}

export interface DuplicateCheckResult {
  isDuplicate: boolean
  existingId?: string
  existingRecord?: Partial<EventRecord>
  missingFields?: string[]
}

export async function checkDuplicate(
  name: string,
  link: string,
  date?: string
): Promise<DuplicateCheckResult> {
  const base = getBase()

  // Exact link match wins — short-circuit before any fuzzy scan. Clean
  // tracking params off the inbound link first so a UTM-tagged copy
  // matches the canonical stored URL.
  const cleanedLink = cleanEventLink(link)
  if (cleanedLink) {
    const linkRecords = await base(EVENTS_TABLE)
      .select({
        filterByFormula: `{Link} = '${cleanedLink.replace(/'/g, "\\'")}'`,
        fields: ['Name', 'Link', 'Date', 'Location', 'Description', 'Audience', 'Type'],
        maxRecords: 1,
      })
      .all()
    if (linkRecords.length) return buildDuplicateResult(linkRecords[0])
  }

  // Fuzzy name check only against events that are still upcoming (or happened
  // within the last 30 days, to catch near-misses on just-passed events).
  // Old archived events get skipped — scoring N>1000 names with stringSimilarity
  // on every submission was the main cost here.
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().split('T')[0]
  const records = await base(EVENTS_TABLE)
    .select({
      filterByFormula: `AND({Date} >= '${cutoff}', {Date} != '')`,
      fields: ['Name', 'Link', 'Date', 'Location', 'Description', 'Audience', 'Type'],
    })
    .all()

  for (const record of records) {
    const existingName = String(record.get('Name') || '')
    const nameSimilarity = existingName
      ? stringSimilarity.compareTwoStrings(
          name.toLowerCase(),
          existingName.toLowerCase()
        )
      : 0
    const nameMatch = nameSimilarity > 0.7
    const dateMatch = !!(date && record.get('Date') === date)

    if ((nameMatch && dateMatch) || nameSimilarity > 0.9) {
      return buildDuplicateResult(record)
    }
  }

  return { isDuplicate: false }
}

function buildDuplicateResult(record: { id: string; get: (f: string) => unknown }): DuplicateCheckResult {
  const missingFields: string[] = []
  if (!record.get('Description')) missingFields.push('description')
  if (!record.get('Audience')) missingFields.push('audience')
  if (!record.get('Type')) missingFields.push('type')
  if (!record.get('Date')) missingFields.push('date')
  if (!record.get('Location')) missingFields.push('location')

  return {
    isDuplicate: true,
    existingId: record.id,
    existingRecord: {
      name: String(record.get('Name') || ''),
      link: String(record.get('Link') || ''),
      date: String(record.get('Date') || ''),
      location: String(record.get('Location') || ''),
      description: String(record.get('Description') || ''),
      type: (record.get('Type') as EventRecord['type']) || 'Other',
      audience: String(record.get('Audience') || '').split(',').map((s) => s.trim()).filter(Boolean),
    },
    missingFields,
  }
}

// Lowercased emails of every user linked in the event's Host field. The
// Host field is a multi-link, so this is the only correct way to ask
// "is this submitter a host of this event?" — single-host probing was
// stale once we started allowing co-hosts. Returns [] for unhosted events.
export async function getEventHostEmails(eventId: string): Promise<string[]> {
  const base = getBase()
  const record = await base(EVENTS_TABLE).find(eventId)
  const hostIds = record.get('Host') as string[] | undefined
  if (!hostIds?.length) return []
  // Per-id find loop is fine — Host arrays are tiny in practice (usually
  // 1-3 partners). Parallel via Promise.all so we don't serialize.
  const records = await Promise.all(
    hostIds.map((id) => base(PROFILES_TABLE).find(id).catch(() => null)),
  )
  return records
    .map((r) => (r ? String(r.get('Email') || '').toLowerCase() : ''))
    .filter(Boolean)
}

// Append a single user id to the event's Host[] linked field. Idempotent —
// if the id is already present, the existing list is preserved and we no-op.
// Used by /api/claim-host. Cache-invalidates the event cache so downstream
// reads see the new host immediately.
export async function addEventHost(eventId: string, userId: string): Promise<void> {
  if (!eventId || !userId) return
  const supabase = getSupabase()

  // Read-modify-write append with idempotency. Concurrent claims on the same
  // event are rare enough that the lost-update race here isn't worth a
  // Postgres RPC; if it becomes a problem, wrap this in a function that does
  // array_append atomically.
  const { data: existing, error: readErr } = await supabase
    .from('events')
    .select('host_ids')
    .eq('id', eventId)
    .maybeSingle()
  if (readErr) {
    console.error('addEventHost read failed', { eventId, userId, readErr })
    throw new Error(`addEventHost read failed: ${readErr.message}`)
  }
  if (!existing) return
  const currentHosts: string[] = Array.isArray(existing.host_ids) ? existing.host_ids : []
  if (currentHosts.includes(userId)) return
  const nextHosts = [...currentHosts, userId]

  const { error: writeErr } = await supabase
    .from('events')
    .update({ host_ids: nextHosts })
    .eq('id', eventId)
  if (writeErr) {
    console.error('addEventHost write failed', { eventId, userId, writeErr })
    throw new Error(`addEventHost write failed: ${writeErr.message}`)
  }

  // Mirror the new host list to Airtable's Host linked field. Fire-and-forget
  // via waitUntil so the partner's claim returns fast and an Airtable hiccup
  // is recoverable by re-claiming.
  waitUntil(
    pushEventToAirtable(
      eventId,
      { Host: nextHosts } as Partial<FieldSet>,
      'addEventHost',
    ),
  )
}

const USER_FIELDS = [
  'Email',
  'Name',
  'FirstName',
  'Function',
  'Seniority',
  'Grade',
  'Size',
  'Interest',
  'Employment',
  'Location',
  'LatLon',
  'Active',
  'Frequency',
  'LinkedIn',
  'Learn',
] as const

// LatLon is stored as a single text field "lat,lng" on both Users and Events.
function parseLatLon(raw: unknown): { lat?: number; lng?: number } {
  const s = String(raw || '').trim()
  if (!s) return {}
  const [latStr, lngStr] = s.split(',').map((p) => p.trim())
  const lat = Number(latStr)
  const lng = Number(lngStr)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {}
  if (lat === 0 && lng === 0) return {}
  return { lat, lng }
}

function formatLatLon(geo: { lat: number; lng: number }): string {
  return `${geo.lat},${geo.lng}`
}

function toAirtableUser(r: {
  id: string
  get: (f: string) => unknown
  _rawJson?: { createdTime?: string }
}): AirtableUser {
  const activeRaw = String(r.get('Active') || '')
  const gradeRaw = String(r.get('Grade') || '').trim()
  const grade = gradeRaw === 'A' || gradeRaw === 'Polish' || gradeRaw === 'B' || gradeRaw === 'C'
    ? (gradeRaw as 'A' | 'Polish' | 'B' | 'C')
    : undefined
  const { lat, lng } = parseLatLon(r.get('LatLon'))
  return {
    id: r.id,
    created: r._rawJson?.createdTime ?? '',
    email: String(r.get('Email') || ''),
    name: String(r.get('Name') || ''),
    firstName: String(r.get('FirstName') || ''),
    function: String(r.get('Function') || ''),
    seniority: String(r.get('Seniority') || ''),
    grade,
    companySize: String(r.get('Size') || ''),
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
  }
}

export async function getPartnerUserByEmail(email: string): Promise<AirtableUser | null> {
  const base = getBase()
  const sanitized = email.replace(/'/g, "\\'")
  const records = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `AND({Email} = '${sanitized}', {Status} = 'Partner')`,
      fields: [...USER_FIELDS],
      maxRecords: 1,
    })
    .all()

  if (!records.length) return null
  return toAirtableUser(records[0])
}

export async function createEvent(
  event: EventRecord,
  hostUserId?: string,
  source?: 'Email' | 'Dashboard',
): Promise<string> {
  const base = getBase()
  // Required fields. Optional fields are added below only when non-empty —
  // Airtable's typed columns (Date in particular) reject empty strings
  // with INVALID_VALUE_FOR_COLUMN, which used to 500 the whole inbound
  // pipeline when Claude couldn't extract a date from the source URL.
  const fields: Partial<FieldSet> = {
    Name: event.name,
    Type: event.type,
    Link: cleanEventLink(event.link),
    Submitter: event.submitter,
  }
  if (event.date) fields['Date'] = event.date
  if (event.location) fields['Location'] = event.location
  if (event.description) fields['Description'] = event.description
  if (event.audience.length) fields['Audience'] = event.audience.join(', ')
  if (event.image) {
    // Airtable attachment fields accept an array of { url } and fetch the
    // bytes themselves, then serve back from their own CDN. The proxy at
    // /api/event-image/[id] falls back to Airtable for any Supabase row
    // whose image_url is still empty, so new chat-submitted events keep
    // displaying images without an extra Supabase Storage upload step.
    ;(fields as Record<string, unknown>)['Image'] = [{ url: event.image }]
  }

  const geo = await geocodeLocation(event.location)
  if (geo) {
    fields['LatLon'] = formatLatLon(geo)
  } else if (event.location) {
    console.warn(`createEvent: could not geocode "${event.location}"`)
  }
  if (hostUserId) fields['Host'] = [hostUserId]
  if (source) fields['Source'] = source

  // Airtable .create() first so we inherit its recXXX id as the canonical
  // Supabase id. Downstream foreign keys (matches.event_id, host links)
  // already use this format; preserving it avoids a schema migration.
  const record = await base(EVENTS_TABLE).create(fields)

  // Then explicit Supabase insert with the same data. No more sync mirror
  // — this is the canonical row going forward.
  const supabase = getSupabase()
  const nowIso = new Date().toISOString()
  const { error } = await supabase.from('events').insert({
    id: record.id,
    name: event.name,
    type: event.type,
    date: event.date || null,
    location: event.location || '',
    description: event.description || '',
    link: cleanEventLink(event.link),
    audience: event.audience || [],
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    submitter_email: event.submitter || '',
    source: source || '',
    image_url: '',
    host_ids: hostUserId ? [hostUserId] : [],
    // status='Pending' is the canonical gate — getFutureEvents and friends
    // filter on status='Live' so a freshly submitted event won't appear in
    // user dashboards until admin approves.
    status: 'Pending',
    featured: false,
    airtable_created_at: nowIso,
  })
  if (error) {
    console.error('createEvent supabase insert failed', { id: record.id, error })
    throw new Error(`createEvent supabase insert failed: ${error.message}`)
  }
  return record.id
}

export async function updateEvent(
  id: string,
  fields: Partial<EventRecord>,
  hostIds?: string[]
): Promise<void> {
  const airtableFields: Partial<FieldSet> = {}
  const supabaseRow: Record<string, unknown> = {}

  if (fields.name !== undefined) {
    airtableFields['Name'] = fields.name
    supabaseRow.name = fields.name
  }
  if (fields.location !== undefined) {
    airtableFields['Location'] = fields.location
    supabaseRow.location = fields.location
    if (fields.location) {
      const geo = await geocodeLocation(fields.location)
      if (geo) {
        airtableFields['LatLon'] = formatLatLon(geo)
        supabaseRow.lat = geo.lat
        supabaseRow.lng = geo.lng
      } else {
        ;(airtableFields as Record<string, unknown>)['LatLon'] = null
        supabaseRow.lat = null
        supabaseRow.lng = null
        console.warn(`updateEvent: could not geocode "${fields.location}"`)
      }
    } else {
      ;(airtableFields as Record<string, unknown>)['LatLon'] = null
      supabaseRow.lat = null
      supabaseRow.lng = null
    }
  }
  if (fields.description !== undefined) {
    airtableFields['Description'] = fields.description
    supabaseRow.description = fields.description
  }
  if (fields.audience !== undefined) {
    airtableFields['Audience'] = fields.audience.join(', ')
    supabaseRow.audience = fields.audience
  }
  if (fields.type !== undefined) {
    airtableFields['Type'] = fields.type
    supabaseRow.type = fields.type
  }
  if (fields.date !== undefined) {
    airtableFields['Date'] = fields.date
    // Empty Airtable date -> NULL on the date column (rejects '').
    supabaseRow.date = fields.date || null
  }
  if (fields.submitter !== undefined) {
    airtableFields['Submitter'] = fields.submitter
    supabaseRow.submitter_email = fields.submitter
  }
  if (hostIds !== undefined) {
    // Replace the full host list. Pass `[]` to clear, an array to set.
    // The admin event detail page is the canonical edit surface; the
    // legacy claim-as-host path still uses addEventHost (atomic append).
    airtableFields['Host'] = hostIds
    supabaseRow.host_ids = hostIds
  }
  // Image is a sentinel: undefined means "leave alone", empty string means
  // "clear", non-empty URL means "set". Airtable side mirrors as an
  // attachment; Supabase side stores the public URL string.
  if (fields.image !== undefined) {
    ;(airtableFields as Record<string, unknown>)['Image'] =
      fields.image ? [{ url: fields.image }] : []
    supabaseRow.image_url = fields.image || ''
  }
  if (fields.featured !== undefined) {
    // Airtable's checkbox field is singular ("Feature"); the Supabase column
    // is semantically correct ("featured").
    ;(airtableFields as Record<string, unknown>)['Feature'] = !!fields.featured
    supabaseRow.featured = !!fields.featured
  }
  if (fields.status !== undefined) {
    // Status is Supabase-only for now — Airtable Events table doesn't have a
    // Status field today. If the admin adds one later, wire it into
    // airtableFields here. Tracked under the Airtable-mirror cleanup item.
    supabaseRow.status = fields.status
  }

  // Supabase first as the canonical write. Failures bubble up — caller
  // (admin save) needs to know if the change didn't land.
  if (Object.keys(supabaseRow).length > 0) {
    const supabase = getSupabase()
    const { error } = await supabase.from('events').update(supabaseRow).eq('id', id)
    if (error) {
      console.error('updateEvent supabase update failed', { id, error })
      throw new Error(`updateEvent supabase update failed: ${error.message}`)
    }
  }

  // Then mirror to Airtable as the follower write. waitUntil so admin save
  // returns fast and an Airtable hiccup doesn't bounce the response.
  waitUntil(pushEventToAirtable(id, airtableFields, 'updateEvent'))
}

export interface Partner {
  id: string
  name: string
  type: string
  logoUrl: string
  website: string
  description: string
  stars: number
}

export interface FeaturedEvent {
  id: string
  name: string
  description: string
  link: string
  date: string
  location: string
  // Airtable-hosted attachment URL for the event's hero image, when
  // one was captured at parse time. Only rendered on featured-event
  // cards on the homepage today.
  imageUrl?: string
}

// getFeaturedEvents lives in lib/events.ts now (Supabase-backed). The
// Airtable view viwz4UVrptnDATP19 is no longer read at runtime; it stays
// in Airtable as a manual reference of what used to be curated. The
// featured selector is now the `Featured` checkbox column, mirrored into
// events.featured by the sync layer.

export async function getPartners(): Promise<Partner[]> {
  const base = getBase()
  const records = await base('Partners')
    .select({
      // Partners with a non-blank Order field are visible on the site.
      filterByFormula: 'NOT(ISBLANK({Order}))',
      fields: ['Name', 'Logo', 'Site', 'Type', 'Description', 'Stars', 'Order'],
    })
    .all()

  return records
    .map((record) => {
      const logo = record.get('Logo') as Array<{ url: string }> | undefined
      return {
        id: record.id,
        name: String(record.get('Name') || ''),
        type: String(record.get('Type') || ''),
        // Point browsers at our own proxy route (stable, CDN-cached) instead
        // of the raw Airtable signed URL (expires ~2h, so it breaks once cached).
        logoUrl: logo?.[0]?.url ? `/api/partner-logo/${record.id}` : '',
        website: String(record.get('Site') || ''),
        description: String(record.get('Description') || ''),
        stars: Number(record.get('Stars') || 0),
      }
    })
    .filter((p) => p.logoUrl)
}

export interface AirtableUser {
  id: string
  created: string
  email: string
  name: string
  firstName: string
  function: string
  seniority: string
  grade?: 'A' | 'Polish' | 'B' | 'C'
  companySize: string
  interest: string
  employment: string
  location: string
  lat?: number
  lng?: number
  active: boolean
  status: string
  frequency: string
  linkedin: string
  learn: string
}

export interface AirtableEvent {
  id: string
  name: string
  type: string
  date: string
  location: string
  description: string
  link: string
  audience: string[]
  lat?: number
  lng?: number
  /** Airtable record createdTime — when the event row was first added. */
  created: string
  /** True when the Featured checkbox is ticked. Drives the homepage carousel. */
  featured?: boolean
  /**
   * Lifecycle picklist: Pending (new submission, awaiting admin review),
   * Live (admin approved, matched + visible to users), Deactivated (admin
   * pulled, drops out of dashboards). New events default to Pending.
   */
  status?: string
  /** Supabase user IDs of people who host this event. */
  hostIds?: string[]
}

export async function getActiveUsers(): Promise<AirtableUser[]> {
  const base = getBase()
  const records = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `LOWER({Active}) = "active"`,
      fields: [...USER_FIELDS],
    })
    .all()
  return records.map(toAirtableUser).filter((u) => u.email)
}

export async function getFutureEvents(): Promise<AirtableEvent[]> {
  const base = getBase()
  const today = new Date().toISOString().split('T')[0]

  const records = await base(EVENTS_TABLE)
    .select({
      filterByFormula: `AND({Date} >= '${today}', {Date} != '')`,
      fields: ['Name', 'Type', 'Date', 'Location', 'Description', 'Link', 'Audience', 'LatLon'],
    })
    .all()

  const events = records
    .map((r) => {
      const { lat, lng } = parseLatLon(r.get('LatLon'))
      return {
        id: r.id,
        name: String(r.get('Name') || ''),
        type: String(r.get('Type') || ''),
        date: String(r.get('Date') || ''),
        location: String(r.get('Location') || ''),
        description: String(r.get('Description') || ''),
        link: String(r.get('Link') || ''),
        audience: String(r.get('Audience') || '').split(',').map((s) => s.trim()).filter(Boolean),
        lat,
        lng,
        created: r._rawJson?.createdTime ?? '',
      }
    })
    .filter((e) => e.name)

  return events
}

export async function getUserByEmail(email: string): Promise<AirtableUser | null> {
  const base = getBase()
  // LOWER() match — createProfile's upsert check (further down in this
  // file) is case-insensitive, so this lookup needs to agree. Users
  // whose row was first created via inbound event contribution (which
  // stores the From-header email with its original casing) wouldn't
  // be found by a strict-equality match.
  const needle = email.toLowerCase().replace(/'/g, "\\'")
  const records = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `LOWER({Email}) = '${needle}'`,
      fields: [...USER_FIELDS],
      maxRecords: 1,
    })
    .all()

  if (!records.length) return null
  return toAirtableUser(records[0])
}

export interface UserProfileUpdate {
  location?: string
  interest?: string
  employment?: string
  companySize?: string
  frequency?: string
  function?: string
  seniority?: string
}

export async function updateUserProfile(
  email: string,
  update: UserProfileUpdate,
): Promise<{ id: string } | null> {
  const supabase = getSupabase()
  const trimmedEmail = email.trim()
  if (!trimmedEmail) return null

  // Look up by case-insensitive email (mirrors the previous Airtable
  // LOWER({Email}) lookup). Excludes tombstoned rows.
  const { data: existing, error: lookupErr } = await supabase
    .from('users')
    .select('id')
    .ilike('email', trimmedEmail)
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (lookupErr) {
    console.error('updateUserProfile lookup error', { email: trimmedEmail, lookupErr })
    return null
  }
  if (!existing) return null

  const row: Record<string, unknown> = {}
  if (update.location !== undefined) {
    row.location = update.location
    if (update.location) {
      const geo = await geocodeLocation(update.location)
      if (geo) {
        row.lat = geo.lat
        row.lng = geo.lng
      } else {
        row.lat = null
        row.lng = null
        console.warn(`updateUserProfile: could not geocode "${update.location}"`)
      }
    } else {
      row.lat = null
      row.lng = null
    }
  }
  if (update.interest !== undefined) row.interest = update.interest
  if (update.function !== undefined) row.fn = update.function
  // Empty-string -> null on the Supabase side too. The downstream column type
  // is plain text so '' would technically store, but keeping it null means
  // toAirtableUser surfaces a consistent '' when read and the UI's "missing"
  // detection stays simple.
  if (update.employment !== undefined) {
    row.employment = update.employment === '' ? null : update.employment
  }
  if (update.companySize !== undefined) {
    row.company_size = update.companySize === '' ? null : update.companySize
  }
  if (update.frequency !== undefined) {
    row.frequency = update.frequency === '' ? null : update.frequency
  }
  if (update.seniority !== undefined) {
    row.seniority = update.seniority === '' ? null : update.seniority
  }

  if (Object.keys(row).length === 0) return { id: existing.id }
  const { error: updateErr } = await supabase
    .from('users')
    .update(row)
    .eq('id', existing.id)
  if (updateErr) {
    console.error('updateUserProfile update error', { id: existing.id, updateErr })
    throw new Error(`updateUserProfile failed: ${updateErr.message}`)
  }
  return { id: existing.id }
}

// Admin-scoped sibling of updateUserProfile. Keyed by record id (not email),
// accepts the full editable field set, and intentionally is the only path
// that can flip Status / Grade — those are admin actions, not user
// self-service. Writes Supabase directly; Airtable Users is no longer
// touched (since 83580c0). Empty single-select values clear to null on the
// Supabase side, matching the shape callers expect.
export type UserStatus = 'Pending' | 'Live' | 'Passed' | 'Deactivated' | 'Partner'

export interface UserAdminUpdate {
  // Email is editable from the admin user detail page. Safe to change
  // because every cached relation joins by user_id; email is now just a
  // profile attribute. The PATCH route validates format + active-user
  // uniqueness before this layer ever sees the new value.
  email?: string
  name?: string
  firstName?: string
  function?: string
  seniority?: string
  grade?: 'A' | 'Polish' | 'B' | 'C' | ''
  location?: string
  interest?: string
  employment?: string
  companySize?: string
  frequency?: string
  linkedin?: string
  learn?: string
  // Canonical lifecycle picklist (replaces the legacy active boolean).
  // Writes go to Airtable's Status field; sync derives the active and
  // is_partner booleans from it. Pending = newly signed up, Live =
  // approved + matching, Passed = rejected, Deactivated = was Live now off,
  // Partner = special status that also matches.
  status?: UserStatus
}

export async function updateUserAdmin(
  id: string,
  update: UserAdminUpdate,
): Promise<void> {
  const supabase = getSupabase()
  const row: Record<string, unknown> = {}

  if (update.email !== undefined) row.email = update.email
  if (update.name !== undefined) row.name = update.name
  if (update.firstName !== undefined) row.first_name = update.firstName
  // Auto-derive first_name from name (matches the Airtable formula
  // LEFT(Name, FIND(" ", Name)-1)). Fires when name is in the patch but
  // firstName isn't — e.g. enrichment populates the full name from
  // LinkedIn without touching firstName. An explicit firstName in the
  // same patch always wins, so admin can manually override when the
  // first-token heuristic gets it wrong (e.g. "Mary Ann Smith" -> admin
  // sets firstName="Mary Ann").
  if (update.name !== undefined && update.firstName === undefined) {
    row.first_name = deriveFirstName(update.name)
  }
  if (update.function !== undefined) row.fn = update.function
  if (update.interest !== undefined) row.interest = update.interest
  if (update.linkedin !== undefined) row.linkedin = update.linkedin
  if (update.learn !== undefined) row.learn = update.learn

  if (update.location !== undefined) {
    row.location = update.location
    if (update.location) {
      const geo = await geocodeLocation(update.location)
      if (geo) {
        row.lat = geo.lat
        row.lng = geo.lng
      } else {
        row.lat = null
        row.lng = null
        console.warn(`updateUserAdmin: could not geocode "${update.location}"`)
      }
    } else {
      row.lat = null
      row.lng = null
    }
  }

  if (update.seniority !== undefined) {
    row.seniority = update.seniority === '' ? null : update.seniority
  }
  if (update.companySize !== undefined) {
    row.company_size = update.companySize === '' ? null : update.companySize
  }
  if (update.employment !== undefined) {
    row.employment = update.employment === '' ? null : update.employment
  }
  if (update.frequency !== undefined) {
    row.frequency = update.frequency === '' ? null : update.frequency
  }
  if (update.grade !== undefined) {
    row.grade = update.grade === '' ? null : update.grade
  }

  if (update.status !== undefined) {
    // Status is the canonical lifecycle picklist. active and is_partner
    // booleans are derived from it so the matching loop's `active = true`
    // filter stays in sync with the picklist value the admin just picked.
    row.status = update.status
    const { active, is_partner } = deriveLifecycle(update.status)
    row.active = active
    row.is_partner = is_partner
  }

  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('users').update(row).eq('id', id)
  if (error) {
    console.error('updateUserAdmin error', { id, error })
    throw new Error(`updateUserAdmin failed: ${error.message}`)
  }
}


export async function getUserById(userId: string): Promise<AirtableUser | null> {
  const base = getBase()
  try {
    const record = await base(PROFILES_TABLE).find(userId)
    return toAirtableUser(record)
  } catch {
    return null
  }
}

export const DEFAULT_FREQUENCY = 'Monthly'

// Returns the user id along with isNew so callers can fire one-time-only
// signup side effects (Slack alert, welcome email) without re-pinging on
// re-submissions by existing users.
export async function createProfile(
  profile: UserProfile,
): Promise<{ id: string; isNew: boolean }> {
  const supabase = getSupabase()
  const email = profile.email.trim().toLowerCase()

  // Geocode upfront so the row write is a single round-trip.
  let lat: number | null = null
  let lng: number | null = null
  if (profile.location) {
    const geo = await geocodeLocation(profile.location)
    if (geo) {
      lat = geo.lat
      lng = geo.lng
    } else {
      console.warn(`createProfile: could not geocode "${profile.location}"`)
    }
  }

  // Upsert: if a Supabase row already exists for this email (e.g. a minimal
  // user auto-created when they contributed an event pre-signup), update it
  // instead of creating a duplicate.
  const { data: existing, error: lookupErr } = await supabase
    .from('users')
    .select('id, frequency, status')
    .ilike('email', email)
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (lookupErr) {
    console.error('createProfile lookup error', { email, lookupErr })
    throw new Error(`createProfile lookup failed: ${lookupErr.message}`)
  }

  const chosenFrequency = profile.frequency?.trim() || DEFAULT_FREQUENCY
  const cleanedLinkedin = cleanLinkedinUrl(profile.linkedin)
  const baseFields: Record<string, unknown> = {
    linkedin: cleanedLinkedin,
    interest: profile.interest,
    location: profile.location,
    learn: profile.learn,
    employment: profile.employment === '' ? null : profile.employment,
    company_size: profile.companySize === '' ? null : profile.companySize,
    lat,
    lng,
  }

  if (existing) {
    // Overwrite Frequency if the user picked one in the chat; otherwise
    // preserve any existing choice and fall back to the default when blank.
    if (profile.frequency?.trim()) {
      baseFields.frequency = chosenFrequency
    } else if (!String(existing.frequency || '').trim()) {
      baseFields.frequency = DEFAULT_FREQUENCY
    }
    // Default Status to Pending only when the existing row has no status yet
    // (e.g. auto-created by a pre-signup contribution). Returning Live /
    // Partner / Deactivated users who re-submit the form keep their status —
    // don't bounce them back into the approval queue.
    if (!String(existing.status || '').trim()) {
      baseFields.status = 'Pending'
      const { active, is_partner } = deriveLifecycle('Pending')
      baseFields.active = active
      baseFields.is_partner = is_partner
    }
    const { error: updateErr } = await supabase
      .from('users')
      .update(baseFields)
      .eq('id', existing.id)
    if (updateErr) {
      console.error('createProfile update error', { id: existing.id, updateErr })
      throw new Error(`createProfile update failed: ${updateErr.message}`)
    }
    // Attribute any prior pre-signup contributions to this freshly-known user.
    linkContributionsToUser(existing.id, email).catch((e) =>
      console.error('createProfile: linkContributionsToUser failed', e),
    )
    return { id: existing.id, isNew: false }
  }

  // Brand-new signup. Generate an Airtable-shaped id so downstream foreign
  // keys (matches.user_id, contributions.airtable_user_id, events.host_ids)
  // stay consistent with the existing rec-prefixed format.
  const id = newUserId()
  const nowIso = new Date().toISOString()
  const { active, is_partner } = deriveLifecycle('Pending')
  const { error: insertErr } = await supabase.from('users').insert({
    id,
    email,
    ...baseFields,
    frequency: chosenFrequency,
    status: 'Pending',
    active,
    is_partner,
    // airtable_created_at preserves the "signed up at" semantic the admin
    // dashboard reads; matches what sync used to mirror from Airtable's
    // createdTime field.
    airtable_created_at: nowIso,
  })
  if (insertErr) {
    console.error('createProfile insert error', { id, email, insertErr })
    throw new Error(`createProfile insert failed: ${insertErr.message}`)
  }
  linkContributionsToUser(id, email).catch((e) =>
    console.error('createProfile: linkContributionsToUser failed', e),
  )
  return { id, isNew: true }
}

// Future events where the given Airtable user id appears in the Host linked
// field. Filtered in-memory because Airtable formula functions can't compare
// against linked-record ids directly (ARRAYJOIN flattens to primary-field
// values, not ids).
export async function getEventsHostedBy(userId: string): Promise<AirtableEvent[]> {
  if (!userId) return []
  const base = getBase()
  const today = new Date().toISOString().split('T')[0]
  const records = await base(EVENTS_TABLE)
    .select({
      filterByFormula: `AND({Date} >= '${today}', {Date} != '')`,
      fields: ['Name', 'Type', 'Date', 'Location', 'Description', 'Link', 'Audience', 'LatLon', 'Host'],
    })
    .all()

  return records
    .filter((r) => {
      const hosts = r.get('Host') as string[] | undefined
      return !!hosts && hosts.includes(userId)
    })
    .map((r) => {
      const { lat, lng } = parseLatLon(r.get('LatLon'))
      return {
        id: r.id,
        name: String(r.get('Name') || ''),
        type: String(r.get('Type') || ''),
        date: String(r.get('Date') || ''),
        location: String(r.get('Location') || ''),
        description: String(r.get('Description') || ''),
        link: String(r.get('Link') || ''),
        audience: String(r.get('Audience') || '').split(',').map((s) => s.trim()).filter(Boolean),
        lat,
        lng,
        created: r._rawJson?.createdTime ?? '',
      }
    })
    .filter((e) => e.name)
}

// Returns the event only if the given user id is a Host. Used by the host
// detail/edit routes as an authorization check.
export async function getEventByIdIfHost(
  eventId: string,
  userId: string,
): Promise<AirtableEvent | null> {
  if (!eventId || !userId) return null
  const base = getBase()
  try {
    const r = await base(EVENTS_TABLE).find(eventId)
    const hosts = r.get('Host') as string[] | undefined
    if (!hosts || !hosts.includes(userId)) return null
    const { lat, lng } = parseLatLon(r.get('LatLon'))
    return {
      id: r.id,
      name: String(r.get('Name') || ''),
      type: String(r.get('Type') || ''),
      date: String(r.get('Date') || ''),
      location: String(r.get('Location') || ''),
      description: String(r.get('Description') || ''),
      link: String(r.get('Link') || ''),
      audience: String(r.get('Audience') || '').split(',').map((s) => s.trim()).filter(Boolean),
      lat,
      lng,
      created: r._rawJson?.createdTime ?? '',
    }
  } catch {
    return null
  }
}

// Admin-side single-event fetch (no host check). Used by
// /api/admin/events/[id] so an admin can drill into any event.
export async function getEventById(eventId: string): Promise<AirtableEvent | null> {
  if (!eventId) return null
  const base = getBase()
  try {
    const r = await base(EVENTS_TABLE).find(eventId)
    const { lat, lng } = parseLatLon(r.get('LatLon'))
    return {
      id: r.id,
      name: String(r.get('Name') || ''),
      type: String(r.get('Type') || ''),
      date: String(r.get('Date') || ''),
      location: String(r.get('Location') || ''),
      description: String(r.get('Description') || ''),
      link: String(r.get('Link') || ''),
      audience: String(r.get('Audience') || '').split(',').map((s) => s.trim()).filter(Boolean),
      lat,
      lng,
      created: r._rawJson?.createdTime ?? '',
    }
  } catch {
    return null
  }
}

// Single-shot mutation used by /api/submit-partner. Match Partners by
// case-insensitive Name — if found, overwrite the application fields; if
// not, create a new row with Status left blank so it doesn't show on the
// public /partners directory until admin review.
export interface PartnerApplication {
  email: string
  company: string
  audience: string
  description: string
}

// Airtable rejects an ENTIRE write with a 422 if any single field name
// doesn't exist (UNKNOWN_FIELD_NAME) or the value type doesn't match
// the column type (INVALID_VALUE_FOR_COLUMN, e.g. sending a string into
// a Number column). This helper retries, dropping the offending field
// one at a time, so a partial schema or one bad value degrades to
// writing the other fields rather than nuking the whole application.
// Dropped fields are logged so the gap surfaces in Vercel logs.
function parseProblemField(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e)
  // UNKNOWN_FIELD_NAME format: Unknown field name: "Foo"
  const m1 = msg.match(/Unknown field name:\s*"([^"]+)"/i)
  if (m1) return m1[1]
  // INVALID_VALUE_FOR_COLUMN format: Field "Foo" cannot accept the provided value
  const m2 = msg.match(/Field\s+"([^"]+)"\s+cannot accept/i)
  if (m2) return m2[1]
  return null
}

async function writeWithKnownFields(
  table: string,
  recordId: string | null,
  fields: Partial<FieldSet>,
): Promise<string> {
  const base = getBase()
  const working: Partial<FieldSet> = { ...fields }
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      if (recordId) {
        await base(table).update(recordId, working)
        return recordId
      }
      const created = await base(table).create(working)
      return created.id
    } catch (e) {
      const field = parseProblemField(e)
      if (!field || !(field in working)) throw e
      console.error(
        `writeWithKnownFields: dropping "${field}" on ${table} —`,
        e instanceof Error ? e.message : e,
      )
      delete (working as Record<string, unknown>)[field]
    }
  }
  throw new Error(`writeWithKnownFields: exhausted retries on ${table}`)
}

export async function upsertPartnerApplication(
  app: PartnerApplication,
): Promise<{ partnerId: string }> {
  const base = getBase()
  const companyName = app.company.trim()
  const sanitizedCompany = companyName.replace(/'/g, "\\'")

  const partnerFields: Partial<FieldSet> = {
    Name: companyName,
    Email: app.email.trim().toLowerCase(),
    Audience: app.audience.trim(),
    Description: app.description.trim(),
  }

  const existingPartner = await base(PARTNERS_TABLE)
    .select({
      filterByFormula: `LOWER({Name}) = '${sanitizedCompany.toLowerCase()}'`,
      fields: ['Name'],
      maxRecords: 1,
    })
    .all()

  const partnerId = await writeWithKnownFields(
    PARTNERS_TABLE,
    existingPartner.length ? existingPartner[0].id : null,
    partnerFields,
  )

  return { partnerId }
}
