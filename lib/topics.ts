// Static taxonomy backing the chip picker on signup, the dashboard edit
// modal, and the /welcome quick form. Refreshed manually by re-running
// the cross-reference of user Interest answers against the event
// audience/name/description corpus, then editing this file.
//
// Order of groups = display order. Order of topics within a group =
// display order. Colors are chosen from the brand palette and rendered
// by components/TopicChips.tsx.

export interface TopicGroup {
  label: string
  // Brand palette key — resolved to concrete CSS by components/TopicChips.
  color: 'burgundy' | 'sage' | 'slate' | 'gold'
  topics: string[]
}

export const TOPIC_TAXONOMY: TopicGroup[] = [
  {
    label: 'Industries',
    color: 'sage',
    topics: ['SaaS', 'B2B Tech', 'Fintech', 'Healthcare'],
  },
  {
    label: 'Functions',
    color: 'burgundy',
    topics: [
      'GTM',
      'RevOps',
      'Sales',
      'Sales Development',
      'Marketing',
      'Marketing Ops',
      'Demand Gen',
      'Customer Success',
      'Customer Experience',
      'Enablement',
      'GTM Engineering',
    ],
  },
  {
    label: 'Themes',
    color: 'slate',
    topics: [
      'AI',
      'AI agents',
      'Agentic AI',
      'AI in GTM',
      'AI for Marketing',
      'Fundraising',
      'Sales Comp',
      'Growth',
      'Pipeline & Forecasting',
    ],
  },
  {
    label: 'Communities',
    color: 'gold',
    topics: ['Founders', 'Women', 'AAPI', 'VC & PE'],
  },
]

// Flat lookup — handy where we just need "is this a known topic?".
export const ALL_TOPICS: string[] = TOPIC_TAXONOMY.flatMap((g) => g.topics)

// Parse a user-entered comma-separated topics string into an array of
// trimmed, non-empty topics. Case-preserved.
export function parseTopics(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

// Case-insensitive membership check used by the chip picker to highlight
// the chips that are already in the user's input.
export function hasTopic(topics: string[], candidate: string): boolean {
  const lower = candidate.toLowerCase()
  return topics.some((t) => t.toLowerCase() === lower)
}

// Add a topic if absent (case-insensitive), or remove it if present.
// Returns a new comma-separated string with consistent spacing.
export function toggleTopic(current: string, topic: string): string {
  const list = parseTopics(current)
  if (hasTopic(list, topic)) {
    return list.filter((t) => t.toLowerCase() !== topic.toLowerCase()).join(', ')
  }
  return [...list, topic].join(', ')
}
