// Taxonomy metadata + seed defaults for the chip picker.
//
// The live topic list lives in the Supabase 'topics' table — admin
// edits it via /admin/topics, and the chip picker reads via the public
// /api/topics endpoint. This file keeps:
//
//   • TAXONOMY_GROUPS — the 4 group labels + their brand colors, in
//     display order. Group metadata stays in code because color is part
//     of design, not data.
//
//   • DEFAULT_TOPICS — initial 28 chips used by the admin "Seed
//     defaults" button when the topics table is empty. Also used as
//     the immediate-render fallback for the chip picker before the
//     /api/topics fetch resolves (avoids cold-load flicker).
//
//   • TAXONOMY_LABELS — convenience constant for the admin dropdown.

export type TaxonomyLabel = 'Industries' | 'Functions' | 'Themes' | 'Communities'

export interface TaxonomyGroupMeta {
  label: TaxonomyLabel
  // Brand palette key — resolved to concrete CSS by components/TopicChips.
  color: 'burgundy' | 'sage' | 'slate' | 'gold'
}

export const TAXONOMY_GROUPS: TaxonomyGroupMeta[] = [
  { label: 'Industries', color: 'sage' },
  { label: 'Functions', color: 'burgundy' },
  { label: 'Themes', color: 'slate' },
  { label: 'Communities', color: 'gold' },
]

export const TAXONOMY_LABELS: TaxonomyLabel[] = TAXONOMY_GROUPS.map((g) => g.label)

export interface DefaultTopic {
  name: string
  taxonomy: TaxonomyLabel
}

// Seed list — 28 chips, anchored against the real event corpus. The
// order here becomes the initial sort_order in the database; admin can
// reorder afterward.
export const DEFAULT_TOPICS: DefaultTopic[] = [
  // Industries
  { name: 'SaaS', taxonomy: 'Industries' },
  { name: 'B2B Tech', taxonomy: 'Industries' },
  { name: 'Fintech', taxonomy: 'Industries' },
  { name: 'Healthcare', taxonomy: 'Industries' },
  // Functions
  { name: 'GTM', taxonomy: 'Functions' },
  { name: 'RevOps', taxonomy: 'Functions' },
  { name: 'Sales', taxonomy: 'Functions' },
  { name: 'Sales Development', taxonomy: 'Functions' },
  { name: 'Marketing', taxonomy: 'Functions' },
  { name: 'Marketing Ops', taxonomy: 'Functions' },
  { name: 'Demand Gen', taxonomy: 'Functions' },
  { name: 'Customer Success', taxonomy: 'Functions' },
  { name: 'Customer Experience', taxonomy: 'Functions' },
  { name: 'Enablement', taxonomy: 'Functions' },
  { name: 'GTM Engineering', taxonomy: 'Functions' },
  // Themes
  { name: 'AI', taxonomy: 'Themes' },
  { name: 'AI agents', taxonomy: 'Themes' },
  { name: 'Agentic AI', taxonomy: 'Themes' },
  { name: 'AI in GTM', taxonomy: 'Themes' },
  { name: 'AI for Marketing', taxonomy: 'Themes' },
  { name: 'Fundraising', taxonomy: 'Themes' },
  { name: 'Sales Comp', taxonomy: 'Themes' },
  { name: 'Growth', taxonomy: 'Themes' },
  { name: 'Pipeline & Forecasting', taxonomy: 'Themes' },
  // Communities
  { name: 'Founders', taxonomy: 'Communities' },
  { name: 'Women', taxonomy: 'Communities' },
  { name: 'AAPI', taxonomy: 'Communities' },
  { name: 'VC & PE', taxonomy: 'Communities' },
]

// Parse a user-entered comma-separated topics string into an array of
// trimmed, non-empty topics. Case-preserved.
export function parseTopics(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

// Case-insensitive membership check used by the chip picker to
// highlight chips that are already in the user's input.
export function hasTopic(topics: string[], candidate: string): boolean {
  const lower = candidate.toLowerCase()
  return topics.some((t) => t.toLowerCase() === lower)
}

// Add a topic if absent (case-insensitive), or remove it if present.
// Returns a new comma-separated string.
export function toggleTopic(current: string, topic: string): string {
  const list = parseTopics(current)
  if (hasTopic(list, topic)) {
    return list.filter((t) => t.toLowerCase() !== topic.toLowerCase()).join(', ')
  }
  return [...list, topic].join(', ')
}
