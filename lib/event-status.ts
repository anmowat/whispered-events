// Shared event lifecycle picklist helpers — parallel to lib/user-status.ts.
// Three states: Pending (new events awaiting admin review), Live (admin
// approved, matched + shown to users), Deactivated (admin pulled, drops out
// of user dashboards). Same pill / dot styling pattern as users.

export type EventStatus = 'Pending' | 'Live' | 'Deactivated'

export const EVENT_STATUS_OPTIONS: EventStatus[] = ['Pending', 'Live', 'Deactivated']

const VALID = new Set<string>(EVENT_STATUS_OPTIONS)

export function normalizeEventStatus(raw: string): EventStatus {
  if (VALID.has(raw)) return raw as EventStatus
  return 'Pending'
}

// Soft palette for the text pill rendered on the admin event detail page.
export function eventStatusPillClass(s: EventStatus): string {
  switch (s) {
    case 'Live': return 'bg-green-100 text-green-800 border-green-200'
    case 'Pending': return 'bg-amber-100 text-amber-800 border-amber-200'
    case 'Deactivated': return 'bg-gray-100 text-gray-600 border-gray-200'
  }
}

// Bold solid bg for the small color-only dot on the admin events list.
export function eventStatusDotClass(s: EventStatus): string {
  switch (s) {
    case 'Live': return 'bg-green-500 border-green-600'
    case 'Pending': return 'bg-amber-500 border-amber-600'
    case 'Deactivated': return 'bg-gray-400 border-gray-500'
  }
}
