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
  if (fields.description) updateData['Description'] = fields.description
  if (fields.audience?.length) updateData['Audience'] = fields.audience.join(', ')
  if (fields.type) updateData['Type'] = fields.type
  if (fields.date) updateData['Date'] = fields.date
  if (fields.host !== undefined) updateData['Host'] = fields.host
  await base(EVENTS_TABLE).update(id, updateData)
}

export async function createProfile(profile: UserProfile): Promise<string> {
  const base = getBase()
  const record = await base(PROFILES_TABLE).create({
    Name: profile.name,
    LinkedIn: profile.linkedin,
    Function: profile.function,
    Seniority: profile.seniority,
    'Size': profile.companySize,
    Expertise: profile.expertise,
    Affiliation: profile.affiliation,
    Email: profile.email,
  } as Partial<FieldSet>)
  return record.id
}
