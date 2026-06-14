import { NextResponse } from 'next/server'
import { getTopics } from '@/lib/supabase'
import { TAXONOMY_GROUPS, DEFAULT_TOPICS, TaxonomyLabel } from '@/lib/topics'

// Public endpoint read by the chip picker (components/TopicChips).
// Returns the live topic list grouped by taxonomy in the canonical
// display order, with each group's brand-color key. If the database
// is empty (e.g. before the admin has seeded defaults) we fall back
// to the in-code DEFAULT_TOPICS so signup never shows an empty chip
// cloud.

export const dynamic = 'force-dynamic'

interface ApiGroup {
  label: TaxonomyLabel
  color: string
  topics: string[]
}

export async function GET() {
  const live = await getTopics()
  const groupsByLabel = new Map<TaxonomyLabel, string[]>()
  for (const g of TAXONOMY_GROUPS) groupsByLabel.set(g.label, [])

  if (live.length > 0) {
    for (const t of live) {
      const bucket = groupsByLabel.get(t.taxonomy as TaxonomyLabel)
      if (bucket) bucket.push(t.name)
    }
  } else {
    for (const t of DEFAULT_TOPICS) {
      const bucket = groupsByLabel.get(t.taxonomy)
      if (bucket) bucket.push(t.name)
    }
  }

  const groups: ApiGroup[] = TAXONOMY_GROUPS.map((g) => ({
    label: g.label,
    color: g.color,
    topics: groupsByLabel.get(g.label) ?? [],
  }))

  return NextResponse.json({ groups })
}
