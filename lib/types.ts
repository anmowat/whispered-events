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
  // Toggled from admin to surface this event on the public homepage
  // carousel. Mirrored to Supabase events.featured by the sync layer.
  featured?: boolean
  // Lifecycle picklist: Pending (default for new submissions),
  // Live (admin approved, matched + visible), Deactivated (admin pulled).
  // Only ever set via the admin event detail page; never by createEvent.
  status?: 'Pending' | 'Live' | 'Deactivated'
  // Invite targeting filters — set by admin or host; matching logic will
  // enforce these in a future phase. Empty array = no filter (all invited).
  inviteEmployment?: string[]
  inviteCompanySize?: string[]
  inviteSeniority?: string[]
}

export const INVITE_EMPLOYMENT_OPTIONS = ['Employed', 'Searching', 'Fractional', 'Other'] as const
export const INVITE_COMPANY_SIZE_OPTIONS = ['1-50', '51-200', '201-1000', '1000+'] as const
export const INVITE_SENIORITY_OPTIONS = ['C-Level', 'VP', 'Director', 'Lead', 'Manager', 'Junior'] as const

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
