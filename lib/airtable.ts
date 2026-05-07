import Airtable, { FieldSet, Base } from 'airtable'
import { EventRecord, UserProfile } from './types'
import stringSimilarity from 'string-similarity'
import { geocodeLocation } from './geocode'

const EVENTS_TABLE = 'Events'
const PROFILES_TABLE = 'Users'

function getBase(): Base {
  if (!process.env.AIRTABLE_API_KEY) {
    throw new Error('AIRTABLE_API_KEY is not set')
  }
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base('appK8AqOvtEgIquRT')
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
  const allRecords = await base(EVENTS_TABLE)
    .select({ fields: ['Name', 'Link', 'Date', 'Location', 'Description', 'Audience', 'Type'] })
    .all()

  for (const record of allRecords) {
    const existingName = String(record.get('Name') || '')
    const existingLink = String(record.get('Link') || '')

    const linkMatch = !!(link && existingLink && existingLink === link)
    const nameSimilarity = existingName
      ? stringSimilarity.compareTwoStrings(
          name.toLowerCase(),
          existingName.toLowerCase()
        )
      : 0
    const nameMatch = nameSimilarity > 0.7
    const dateMatch = !!(date && record.get('Date') === date)

    if (linkMatch || (nameMatch && dateMatch) || nameSimilarity > 0.9) {
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
          name: existingName,
          link: existingLink,
          date: String(record.get('Date') || ''),
          location: String(record.get('Location') || ''),
          description: String(record.get('Description') || ''),
          type: (record.get('Type') as EventRecord['type']) || 'Other',
          audience: String(record.get('Audience') || '').split(',').map(s => s.trim()).filter(Boolean),
        },
        missingFields,
      }
    }
  }

  return { isDuplicate: false }
}

export async function getEventHostEmail(eventId: string): Promise<string | null> {
  const base = getBase()
  const record = await base(EVENTS_TABLE).find(eventId)
  const hostIds = record.get('Host') as string[] | undefined
  if (!hostIds?.length) return null
  const hostRecord = await base(PROFILES_TABLE).find(hostIds[0])
  const email = String(hostRecord.get('Email') || '')
  return email.toLowerCase() || null
}

const USER_FIELDS = [
  'Email',
  'Name',
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
  'LastContribution',
  'Contributions',
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

function toAirtableUser(r: { id: string; get: (f: string) => unknown }): AirtableUser {
  const activeRaw = String(r.get('Active') || '')
  const gradeRaw = String(r.get('Grade') || '').trim()
  const grade = gradeRaw === 'A' || gradeRaw === 'Polish' || gradeRaw === 'B' || gradeRaw === 'C'
    ? (gradeRaw as 'A' | 'Polish' | 'B' | 'C')
    : undefined
  const { lat, lng } = parseLatLon(r.get('LatLon'))
  return {
    id: r.id,
    email: String(r.get('Email') || ''),
    name: String(r.get('Name') || ''),
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
    lastContribution: String(r.get('LastContribution') || ''),
    totalContributions: Number(r.get('Contributions') || 0),
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
  const fields: Partial<FieldSet> = {
    Name: event.name,
    Type: event.type,
    Date: event.date,
    Location: event.location,
    Description: event.description,
    Link: event.link,
    Audience: event.audience.join(', '),
    Submitter: event.submitter,
  }
  const geo = await geocodeLocation(event.location)
  if (geo) {
    fields['LatLon'] = formatLatLon(geo)
  } else if (event.location) {
    console.warn(`createEvent: could not geocode "${event.location}"`)
  }
  if (hostUserId) fields['Host'] = [hostUserId]
  const record = await base(EVENTS_TABLE).create(fields)
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
        logoUrl: logo?.[0]?.url || '',
        website: String(record.get('Site') || ''),
        description: String(record.get('Description') || ''),
        featured: record.get('Featured') === true,
      }
    })
    .filter((p) => p.logoUrl)
}

export interface AirtableUser {
  id: string
  email: string
  name: string
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
  lastContribution: string
  totalContributions: number
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
  const base = getBase()

  const records = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `{Active} = "active"`,
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

  return records
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

  if (Object.keys(fields).length === 0) return { id: records[0].id }
  await base(PROFILES_TABLE).update(records[0].id, fields)
  return { id: records[0].id }
}

export async function clearUserMatchCheckbox(userId: string): Promise<void> {
  const base = getBase()
  await base(PROFILES_TABLE).update(userId, { Match: false } as Partial<FieldSet>)
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

export async function updateLastContribution(email: string): Promise<void> {
  const base = getBase()
  const records = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `{Email} = '${email.replace(/'/g, "\\'")}'`,
      fields: ['Email'],
      maxRecords: 1,
    })
    .all()

  if (!records.length) return
  const today = new Date().toISOString().split('T')[0]
  await base(PROFILES_TABLE).update(records[0].id, { LastContribution: today } as Partial<FieldSet>)
}

export async function createProfile(profile: UserProfile): Promise<string> {
  const base = getBase()
  const today = new Date().toISOString().split('T')[0]
  const fields: Partial<FieldSet> = {
    LinkedIn: profile.linkedin,
    Interest: profile.interest,
    Employment: profile.employment,
    'Size': profile.companySize,
    Email: profile.email,
    Location: profile.location,
    LastContribution: today,
  }
  if (profile.location) {
    const geo = await geocodeLocation(profile.location)
    if (geo) {
      fields['LatLon'] = formatLatLon(geo)
    } else {
      console.warn(`createProfile: could not geocode "${profile.location}"`)
    }
  }
  const record = await base(PROFILES_TABLE).create(fields)
  return record.id
}
