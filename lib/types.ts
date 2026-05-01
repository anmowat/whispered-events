export type EventType = 'Conference' | 'Dinner' | 'Virtual' | 'Other'

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
}

export interface ParsedEvent {
  name?: string
  type?: EventType
  date?: string
  location?: string
  description?: string
  link?: string
  audience?: string[]
}

export interface UserProfile {
  name: string
  linkedin: string
  function: string
  seniority: string
  companySize: string
  expertise: string
  affiliation: string
  email: string
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
