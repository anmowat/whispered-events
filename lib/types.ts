export type EventType = 'Conference' | 'Dinner' | 'Virtual' | 'Other'

// Used to reject virtual events at submit time. We no longer accept virtuals.
export const VIRTUAL_LOCATION_RE = /\b(virtual|online|remote|webinar|zoom)\b/i

export interface EventRecord {
  id?: string
  name: string
  type: EventType
  date: string
  location: string
  description: string
  link: string
  audience: string[]
  host: boolean
  submitter: string
  notes?: string
  // og:image (or equivalent) extracted from the source page at parse
  // time. Stored as an Airtable attachment on the Events table and
  // shown on featured-event cards on the homepage.
  image?: string
}

export interface ParsedEvent {
  name?: string
  type?: EventType
  date?: string
  location?: string
  description?: string
  link?: string
  audience?: string[]
  image?: string
}

export interface UserProfile {
  linkedin: string
  interest: string
  employment: string
  companySize: string
  email: string
  location: string
  learn: string
  frequency: string
}

export interface ChatMessage {
  role: 'assistant' | 'user'
  content: string
  timestamp?: Date
}

export type ShareStep =
  | 'welcome'
  | 'input'
  | 'parsing'
  | 'review'
  | 'submitter'
  | 'preview'
  | 'submitted'
  | 'duplicate'
  | 'error'

export type ProfileStep =
  | 'welcome'
  | 'form'
  | 'submitted'
