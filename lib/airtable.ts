import Airtable, { FieldSet, Base } from 'airtable'
import { EventRecord, UserProfile } from './types'
import stringSimilarity from 'string-similarity'

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
    .select({ fields: ['Name', 'Link', 'Date', 'Description', 'Audience', 'Type'] })
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

      return {
        isDuplicate: true,
        existingId: record.id,
        existingRecord: {
          name: existingName,
          link: existingLink,
          date: String(record.get('Date') || ''),
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

export async function createEvent(event: EventRecord): Promise<string> {
  const base = getBase()
  const record = await base(EVENTS_TABLE).create({
    Name: event.name,
    Type: event.type,
    Date: event.date,
    Location: event.location,
    Description: event.description,
    Link: event.link,
    Audience: event.audience.join(', '),
    Host: event.host,
    Submitter: event.submitter,
  } as Partial<FieldSet>)
  return record.id
}

export async function updateEvent(
  id: string,
  fields: Partial<EventRecord>
): Promise<void> {
  const base = getBase()
  const updateData: Partial<FieldSet> = {}
  if (fields.location) updateData['Location'] = fields.location
  if (fields.description) updateData['Description'] = fields.description
  if (fields.audience?.length) updateData['Audience'] = fields.audience.join(', ')
  if (fields.type) updateData['Type'] = fields.type
  if (fields.date) updateData['Date'] = fields.date
  if (fields.host !== undefined) updateData['Host'] = fields.host
  if (fields.submitter) updateData['Submitter'] = fields.submitter
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
}

export async function getFeaturedEvents(): Promise<FeaturedEvent[]> {
  const base = getBase()
  const records = await base('tbltqCrPbZbETbQRl')
    .select({
      view: 'viwz4UVrptnDATP19',
      fields: ['Name', 'Description', 'Link', 'Date'],
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
  companySize: string
  interest: string
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
}

export async function getActiveUsers(): Promise<AirtableUser[]> {
  const base = getBase()
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const cutoff = sixMonthsAgo.toISOString().split('T')[0]

  const records = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `AND({Approved} = 1, IS_AFTER({LastContribution}, '${cutoff}'))`,
      fields: ['Email', 'Name', 'Function', 'Seniority', 'Size', 'Interest'],
    })
    .all()

  return records
    .map((r) => ({
      id: r.id,
      email: String(r.get('Email') || ''),
      name: String(r.get('Name') || ''),
      function: String(r.get('Function') || ''),
      seniority: String(r.get('Seniority') || ''),
      companySize: String(r.get('Size') || ''),
      interest: String(r.get('Interest') || ''),
    }))
    .filter((u) => u.email)
}

export async function getFutureEvents(): Promise<AirtableEvent[]> {
  const base = getBase()
  const today = new Date().toISOString().split('T')[0]

  const records = await base(EVENTS_TABLE)
    .select({
      filterByFormula: `AND({Date} >= '${today}', {Date} != '')`,
      fields: ['Name', 'Type', 'Date', 'Location', 'Description', 'Link', 'Audience'],
    })
    .all()

  return records
    .map((r) => ({
      id: r.id,
      name: String(r.get('Name') || ''),
      type: String(r.get('Type') || ''),
      date: String(r.get('Date') || ''),
      location: String(r.get('Location') || ''),
      description: String(r.get('Description') || ''),
      link: String(r.get('Link') || ''),
      audience: String(r.get('Audience') || '').split(',').map((s) => s.trim()).filter(Boolean),
    }))
    .filter((e) => e.name)
}

export async function getUserByEmail(email: string): Promise<AirtableUser | null> {
  const base = getBase()
  const records = await base(PROFILES_TABLE)
    .select({
      filterByFormula: `{Email} = '${email.replace(/'/g, "\\'")}'`,
      fields: ['Email', 'Name', 'Function', 'Seniority', 'Size', 'Interest'],
      maxRecords: 1,
    })
    .all()

  if (!records.length) return null
  const r = records[0]
  return {
    id: r.id,
    email: String(r.get('Email') || ''),
    name: String(r.get('Name') || ''),
    function: String(r.get('Function') || ''),
    seniority: String(r.get('Seniority') || ''),
    companySize: String(r.get('Size') || ''),
    interest: String(r.get('Interest') || ''),
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
  const record = await base(PROFILES_TABLE).create({
    Name: profile.name || 'DEFAULT',
    LinkedIn: profile.linkedin,
    Function: profile.function,
    Seniority: profile.seniority,
    'Size': profile.companySize,
    Interest: profile.expertise,
    Email: profile.email,
    LastContribution: today,
  } as Partial<FieldSet>)
  return record.id
}
