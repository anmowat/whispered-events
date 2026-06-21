// Shared status picklist helpers — used by the admin user list and the
// admin user detail page. Single source of truth for the lifecycle enum
// values, the dropdown options, and the pill color classes.

export type UserStatus = 'Pending' | 'Live' | 'Passed' | 'Deactivated' | 'Partner'

export const STATUS_OPTIONS: UserStatus[] = ['Pending', 'Live', 'Passed', 'Deactivated', 'Partner']

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
// Same color logic in both the list and the detail page so the UI is
// consistent across the admin surface.
export function statusPillClass(s: UserStatus): string {
  switch (s) {
    case 'Live': return 'bg-green-100 text-green-800 border-green-200'
    case 'Pending': return 'bg-amber-100 text-amber-800 border-amber-200'
    case 'Passed': return 'bg-red-100 text-red-800 border-red-200'
    case 'Deactivated': return 'bg-gray-100 text-gray-600 border-gray-200'
    case 'Partner': return 'bg-purple-100 text-purple-800 border-purple-200'
  }
}
