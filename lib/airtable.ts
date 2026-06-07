import Airtable, { FieldSet, Base } from 'airtable'
import { EventRecord, UserProfile } from './types'
import stringSimilarity from 'string-similarity'
import { geocodeLocation } from './geocode'
import { linkContributionsToUser } from './supabase'

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

// 90-second in-memory cache. Many flows (process-matches, cron digest,
// per-event each-new-event emails) call these multiple times in rapid
// succession; without this cache each call is a full Airtable scan.
const CACHE_TTL_MS = 90_000
const userCache: { value: AirtableUser[] | null; expires: number } = { value: null, expires: 0 }
const eventCache: { value: AirtableEvent[] | null; expires: number } = { value: null, expires: 0 }

export function invalidateUserCache(): void {
  userCache.value = null
  userCache.expires = 0
}

export function invalidateEventCache(): void {
  eventCache.value = null
  eventCache.expires = 0
}

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

  // Exact link match wins — short-circuit before any fuzzy scan.
  if (link) {
    const linkRecords = await base(EVENTS_TABLE)
      .select({
        filterByFormula: `{Link} = '${link.replace(/'/g, "\\'")}'`,
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
  const base = getBase()
  const record = await base(EVENTS_TABLE).find(eventId)
  const existing = (record.get('Host') as string[] | undefined) ?? []
  if (existing.includes(userId)) return
  await base(EVENTS_TABLE).update(eventId, {
    Host: [...existing, userId],
  } as Partial<FieldSet>)
  invalidateEventCache()
}

const USER_FIELDS = [
  'Email',
  'Name',
  'FirstName',
  'Function',
  'Seniority',
  'FullExp',
  'Grade',
  'Size',
  'Interest',
  'Employment',
  'Location',
  'LatLon',
  'Active',
  'Frequency',
  'LinkedIn',
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
    fullExp: String(r.get('FullExp') || ''),
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

export async function createEvent(event: EventRecord, hostUserId?: string): Promise<string> {
  const base = getBase()
  // Required fields. Optional fields are added below only when non-empty —
  // Airtable's typed columns (Date in particular) reject empty strings
  // with INVALID_VALUE_FOR_COLUMN, which used to 500 the whole inbound
  // pipeline when Claude couldn't extract a date from the source URL.
  const fields: Partial<FieldSet> = {
    Name: event.name,
    Type: event.type,
    Link: event.link,
    Submitter: event.submitter,
  }
  if (event.date) fields['Date'] = event.date
  if (event.location) fields['Location'] = event.location
  if (event.description) fields['Description'] = event.description
  if (event.audience.length) fields['Audience'] = event.audience.join(', ')

  const geo = await geocodeLocation(event.location)
  if (geo) {
    fields['LatLon'] = formatLatLon(geo)
  } else if (event.location) {
    console.warn(`createEvent: could not geocode "${event.location}"`)
  }
  if (hostUserId) fields['Host'] = [hostUserId]
  const record = await base(EVENTS_TABLE).create(fields)
  // Bust the cache so the immediately-following processEventTrigger sees the
  // new event.
  invalidateEventCache()
  return record.id
}

export async function updateEvent(
  id: string,
  fields: Partial<EventRecord>,
  hostUserId?: string
): Promise<void> {
  const base = getBase()
  const updateData: Partial<FieldSet> = {}
  if (fields.name) updateData['Name'] = fields.name
  if (fields.location) {
    updateData['Location'] = fields.location
    const geo = await geocodeLocation(fields.location)
    if (geo) {
      updateData['LatLon'] = formatLatLon(geo)
    } else {
      ;(updateData as Record<string, unknown>)['LatLon'] = null
      console.warn(`updateEvent: could not geocode "${fields.location}"`)
    }
  }
  if (fields.description) updateData['Description'] = fields.description
  if (fields.audience?.length) updateData['Audience'] = fields.audience.join(', ')
  if (fields.type) updateData['Type'] = fields.type
  if (fields.date) updateData['Date'] = fields.date
  if (fields.submitter) updateData['Submitter'] = fields.submitter
  if (hostUserId) updateData['Host'] = [hostUserId]
  await base(EVENTS_TABLE).update(id, updateData)
  invalidateEventCache()
}

export interface Partner {
  id: string
  name: string
  type: string
  logoUrl: string
  website: string
  description: string
  featured: boolean
}

export interface FeaturedEvent {
  id: string
  name: string
  description: string
  link: string
  date: string
  location: string
}

export async function getFeaturedEvents(): Promise<FeaturedEvent[]> {
  const base = getBase()
  const records = await base('tbltqCrPbZbETbQRl')
    .select({
      view: 'viwz4UVrptnDATP19',
      fields: ['Name', 'Description', 'Link', 'Date', 'Location'],
      maxRecords: 10,
    })
    .all()
  return records
    .map((r) => ({
      id: r.id,
      name: String(r.get('Name') || ''),
      description: String(r.get('Description') || ''),
      link: String(r.get('Link') || ''),
      date: String(r.get('Date') || ''),
      location: String(r.get('Location') || ''),
    }))
    .filter((e) => e.name)
}

export async function getPartners(): Promise<Partner[]> {
  const base = getBase()
  const records = await base('Partners')
    .select({
      filterByFormula: "{Status} = 'Live'",
      fields: ['Name', 'Logo', 'Site', 'Type', 'Description', 'Featured'],
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
        featured: record.get('Featured') === true,
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
  fullExp: string
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
}

export async function getActiveUsers(): Promise<AirtableUser[]> {
  const now = Date.now()
  if (userCache.value && userCache.expires > now) return userCache.value

  const base = getBase()
  const records = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `LOWER({Active}) = "active"`,
      fields: [...USER_FIELDS],
    })
    .all()
  const users = records.map(toAirtableUser).filter((u) => u.email)

  userCache.value = users
  userCache.expires = now + CACHE_TTL_MS
  return users
}

export async function getFutureEvents(): Promise<AirtableEvent[]> {
  const now = Date.now()
  if (eventCache.value && eventCache.expires > now) return eventCache.value

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
      }
    })
    .filter((e) => e.name)

  eventCache.value = events
  eventCache.expires = now + CACHE_TTL_MS
  return events
}

export async function getUserByEmail(email: string): Promise<AirtableUser | null> {
  const base = getBase()
  const records = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `{Email} = '${email.replace(/'/g, "\\'")}'`,
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
}

export async function updateUserProfile(
  email: string,
  update: UserProfileUpdate,
): Promise<{ id: string } | null> {
  const base = getBase()
  const records = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `{Email} = '${email.replace(/'/g, "\\'")}'`,
      fields: ['Email'],
      maxRecords: 1,
    })
    .all()

  if (!records.length) return null

  const fields: Partial<FieldSet> = {}
  if (update.location !== undefined) {
    fields['Location'] = update.location
    const geo = await geocodeLocation(update.location)
    if (geo) {
      fields['LatLon'] = formatLatLon(geo)
    } else {
      ;(fields as Record<string, unknown>)['LatLon'] = null
      if (update.location) {
        console.warn(`updateUserProfile: could not geocode "${update.location}"`)
      }
    }
  }
  if (update.interest !== undefined) fields['Interest'] = update.interest
  if (update.employment !== undefined) fields['Employment'] = update.employment
  if (update.companySize !== undefined) fields['Size'] = update.companySize
  if (update.frequency !== undefined) fields['Frequency'] = update.frequency

  if (Object.keys(fields).length === 0) return { id: records[0].id }
  await base(PROFILES_TABLE).update(records[0].id, fields)
  invalidateUserCache()
  return { id: records[0].id }
}

export async function clearUserMatchCheckbox(userId: string): Promise<void> {
  const base = getBase()
  await base(PROFILES_TABLE).update(userId, { Match: false } as Partial<FieldSet>)
}

// Same pattern for an Event row's Match checkbox. Used by the admin
// workflow: edit fields on the Event in Airtable -> tick Match -> the
// automation pings /api/airtable-rematch?type=event -> we re-score
// against every eligible user, then uncheck the box.
export async function clearEventMatchCheckbox(eventId: string): Promise<void> {
  const base = getBase()
  await base(EVENTS_TABLE).update(eventId, { Match: false } as Partial<FieldSet>)
}

// Re-geocode the user's Location and write LatLon. Used when an admin may
// have edited Location directly in Airtable (no app-side write to trigger
// geocoding). Safe to call even when Location is unchanged — idempotent.
export async function refreshUserLatLon(userId: string): Promise<void> {
  const base = getBase()
  const record = await base(PROFILES_TABLE).find(userId)
  const location = String(record.get('Location') || '').trim()
  if (!location) return
  const geo = await geocodeLocation(location)
  if (!geo) {
    console.warn(`refreshUserLatLon: could not geocode "${location}" for ${userId}`)
    return
  }
  const fresh = formatLatLon(geo)
  if (String(record.get('LatLon') || '') === fresh) return
  await base(PROFILES_TABLE).update(userId, { LatLon: fresh } as Partial<FieldSet>)
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

export async function createProfile(profile: UserProfile): Promise<string> {
  const base = getBase()
  const email = profile.email.trim().toLowerCase()
  const fields: Partial<FieldSet> = {
    LinkedIn: cleanLinkedinUrl(profile.linkedin),
    Interest: profile.interest,
    Employment: profile.employment,
    'Size': profile.companySize,
    Email: email,
    Location: profile.location,
  }
  if (profile.location) {
    const geo = await geocodeLocation(profile.location)
    if (geo) {
      fields['LatLon'] = formatLatLon(geo)
    } else {
      console.warn(`createProfile: could not geocode "${profile.location}"`)
    }
  }

  // Upsert: if a record already exists for this email (e.g. a minimal user
  // auto-created when they contributed an event), update it instead of
  // creating a duplicate.
  const existing = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `LOWER({Email}) = '${email.replace(/'/g, "\\'")}'`,
      fields: ['Email', 'Frequency'],
      maxRecords: 1,
    })
    .all()
  const chosenFrequency = profile.frequency?.trim() || DEFAULT_FREQUENCY

  if (existing.length) {
    // Overwrite Frequency if the user picked one in the chat; otherwise
    // preserve any existing choice and fall back to the default when blank.
    if (profile.frequency?.trim()) {
      fields['Frequency'] = chosenFrequency
    } else if (!String(existing[0].get('Frequency') || '').trim()) {
      fields['Frequency'] = DEFAULT_FREQUENCY
    }
    await base(PROFILES_TABLE).update(existing[0].id, fields)
    invalidateUserCache()
    // Attribute any prior pre-signup contributions to this freshly-known user.
    linkContributionsToUser(existing[0].id, email).catch((e) =>
      console.error('createProfile: linkContributionsToUser failed', e),
    )
    return existing[0].id
  }

  fields['Frequency'] = chosenFrequency
  const record = await base(PROFILES_TABLE).create(fields)
  invalidateUserCache()
  linkContributionsToUser(record.id, email).catch((e) =>
    console.error('createProfile: linkContributionsToUser failed', e),
  )
  return record.id
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
    }
  } catch {
    return null
  }
}

// Single-shot mutation used by /api/submit-partner. Owns the dedupe rules
// for both tables so the route stays thin:
//   - Partners: match by case-insensitive Name. If found, overwrite the
//     application fields (Audience/Volume/Description) per product spec;
//     if not, create a new row with Status left blank so it doesn't show
//     up on the public /partners directory until admin review.
//   - Users: match by case-insensitive Email. If found, overwrite LinkedIn
//     and (re)link Company; if not, create a new row.
//
// LinkedIn is always written from the application (overwriting any stale
// value) because the applicant just told us their current profile.
export interface PartnerApplication {
  email: string
  company: string
  audience: string
  volume: string
  description: string
  linkedin: string
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
): Promise<{ partnerId: string; userId: string }> {
  const base = getBase()
  const email = app.email.trim().toLowerCase()
  const companyName = app.company.trim()
  const sanitizedCompany = companyName.replace(/'/g, "\\'")

  // Volume is a Number column in Airtable. The client normalizes vague
  // answers ("a lot", "many") to a stringified midpoint when possible;
  // anything that doesn't parse as an integer we omit entirely rather
  // than 422'ing the application.
  const volumeNum = parseInt(app.volume, 10)
  const partnerFields: Partial<FieldSet> = {
    Name: companyName,
    Audience: app.audience.trim(),
    Description: app.description.trim(),
  }
  if (Number.isFinite(volumeNum)) {
    partnerFields.Volume = volumeNum
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

  const sanitizedEmail = email.replace(/'/g, "\\'")
  const existingUser = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `LOWER({Email}) = '${sanitizedEmail}'`,
      fields: ['Email'],
      maxRecords: 1,
    })
    .all()

  const linkedinValue = cleanLinkedinUrl(app.linkedin)
  // Existing user: don't rewrite Email (preserves casing/history).
  // New user: include Email. 'Partners' is the link field on the Users
  // table pointing back to the Partners table.
  const userFields: Partial<FieldSet> = existingUser.length
    ? { LinkedIn: linkedinValue, Partners: [partnerId] }
    : { Email: email, LinkedIn: linkedinValue, Partners: [partnerId] }

  const userId = await writeWithKnownFields(
    PROFILES_TABLE,
    existingUser.length ? existingUser[0].id : null,
    userFields,
  )

  invalidateUserCache()
  return { partnerId, userId }
}
