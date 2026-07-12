// Shared status picklist helpers — used by the admin user list and the
// admin user detail page. Single source of truth for the lifecycle enum
// values, the dropdown options, and the pill color classes.

export type UserStatus = 'Pending' | 'Live' | 'Passed' | 'Deactivated' | 'Partner'

export const STATUS_OPTIONS: UserStatus[] = ['Partner', 'Live', 'Pending', 'Passed', 'Deactivated']

const VALID = new Set<string>(STATUS_OPTIONS)

// Map any raw status string into the canonical enum so the dropdown and
// pill always have something valid to render. Empty / unknown / legacy
// "Active" all collapse to the closest match — "Active" → Live, anything
// else → Pending so admin sees it in the To Approve queue.
export function normalizeStatus(raw: string): UserStatus {
  if (VALID.has(raw)) return raw as UserStatus
  if (raw.toLowerCase() === 'active') return 'Live'
  return 'Pending'
}

// Tailwind class string for a status pill (border + bg + text color).
// Soft palette designed for use with text inside the pill — the detail
// page renders the status name in the pill, so it needs readable
// contrast between text and background.
export function statusPillClass(s: UserStatus): string {
  switch (s) {
    case 'Live': return 'bg-green-100 text-green-800 border-green-200'
    case 'Pending': return 'bg-amber-100 text-amber-800 border-amber-200'
    case 'Passed': return 'bg-red-100 text-red-800 border-red-200'
    case 'Deactivated': return 'bg-gray-100 text-gray-600 border-gray-200'
    case 'Partner': return 'bg-purple-100 text-purple-800 border-purple-200'
  }
}

// Bold solid bg + matching border for the no-text dot indicator used in
// dense list rows. Higher saturation than the pill palette so the dot is
// legible at 8px without text.
export function statusDotClass(s: UserStatus): string {
  switch (s) {
    case 'Live': return 'bg-green-500 border-green-600'
    case 'Pending': return 'bg-amber-500 border-amber-600'
    case 'Passed': return 'bg-red-500 border-red-600'
    case 'Deactivated': return 'bg-gray-400 border-gray-500'
    case 'Partner': return 'bg-purple-500 border-purple-600'
  }
}
