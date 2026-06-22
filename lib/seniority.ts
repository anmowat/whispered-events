// Seniority picklist for the admin user edit form. Same shape as the
// status / event-status helpers — exported enum + display options +
// a normalize helper for legacy values.
//
// Values match the labels enrichment emits (lib/enrich.ts:SENIORITY_RULES)
// so a freshly enriched user lands on a canonical option without
// admin intervention. Order here is the conventional top-down ranking
// (C-Level at the top); enrichment's internal rule order is separate
// (it's keyword-match precedence, which is intentionally Manager-before-
// Lead so "Manager" wins on ambiguous titles).

export const SENIORITY_OPTIONS = [
  'C-Level',
  'VP',
  'Director',
  'Lead',
  'Manager',
  'Junior',
] as const

export type Seniority = (typeof SENIORITY_OPTIONS)[number]

const VALID = new Set<string>(SENIORITY_OPTIONS)

// Map a stored seniority string into the canonical enum, returning '' for
// legacy values that fall outside the picklist (e.g. "Senior", "Principal").
// The admin edit form renders this so legacy strings show as "—" in the
// dropdown and admin can pick a canonical value on save.
export function normalizeSeniority(raw: string): Seniority | '' {
  if (VALID.has(raw)) return raw as Seniority
  return ''
}
