import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { isAdmin } from '@/lib/admin-auth'
import { updateEvent } from '@/lib/airtable'

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

const VALID_TYPES = ['Conference', 'Dinner', 'Happy Hour', 'Panel', 'Workshop', 'Activity', 'Other'] as const
type NewEventType = (typeof VALID_TYPES)[number]

const CLASSIFY_PROMPT = `You are classifying a business event into exactly one category based on its FORMAT (not topic).

Categories:
- Conference: large multi-session event, agenda, badges, summits
- Dinner: meal is the centerpiece (seated dinner, dinner party, supper)
- Happy Hour: drinks-centered social (happy hours, mixers, soirées, rooftop drinks, receptions, BBQs, launch parties, cocktail receptions, tastings)
- Panel: seated discussion-led single-topic (panels, roundtables, fireside chats, exec briefings)
- Workshop: hands-on/build/lab format (workshops, hackathons, labs, training sessions)
- Activity: shared activity/experience as main draw (golf, sailing, poker, sports, tours, cooking classes)
- Other: genuine catch-all only (meetups, community meetings, retreats, morning coffee, breakfast networking)

Rules:
1. Classify by PRIMARY DRAW of the event format, not the topic.
2. If tied: Conference > Dinner > Activity > Workshop > Panel > Happy Hour > Other.
3. Classify the event ITSELF, not adjacent events it appears alongside.
4. Morning coffee / breakfast events → Other.

Event name: {NAME}
Description: {DESC}

Reply with ONLY the category name, nothing else.`

async function classifyEvent(
  anthropic: Anthropic,
  name: string,
  description: string,
): Promise<NewEventType> {
  const prompt = CLASSIFY_PROMPT
    .replace('{NAME}', name)
    .replace('{DESC}', description || '(no description)')

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = (msg.content[0] as { type: string; text: string }).text?.trim() ?? ''
    const found = VALID_TYPES.find((t) => raw.toLowerCase().startsWith(t.toLowerCase()))
    return found ?? 'Other'
  } catch {
    return 'Other'
  }
}

export interface ReclassifyChange {
  id: string
  name: string
  currentType: string
  proposedType: NewEventType
  date: string
  location: string
}

export interface ReclassifyResult {
  changes: ReclassifyChange[]
  unchanged: { id: string; name: string; type: string }[]
  stats: { total: number; changed: number; byNewType: Record<string, number> }
}

// GET: dry-run — returns proposed changes without writing anything
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('events')
    .select('id, name, type, description, date, location')
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
    .not('name', 'is', null)
    .order('date', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as {
    id: string
    name: string | null
    type: string | null
    description: string | null
    date: string | null
    location: string | null
  }[]

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Process in parallel batches of 10 to stay well under rate limits
  const BATCH = 10
  const changes: ReclassifyChange[] = []
  const unchanged: { id: string; name: string; type: string }[] = []

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map((row) =>
        classifyEvent(anthropic, row.name ?? '', row.description ?? ''),
      ),
    )
    for (let j = 0; j < batch.length; j++) {
      const row = batch[j]
      const proposed = results[j]
      const current = row.type ?? ''
      if (proposed !== current) {
        changes.push({
          id: row.id,
          name: row.name ?? '',
          currentType: current,
          proposedType: proposed,
          date: row.date ?? '',
          location: row.location ?? '',
        })
      } else {
        unchanged.push({ id: row.id, name: row.name ?? '', type: current })
      }
    }
  }

  const byNewType: Record<string, number> = {}
  for (const c of changes) {
    byNewType[c.proposedType] = (byNewType[c.proposedType] ?? 0) + 1
  }

  const result: ReclassifyResult = {
    changes,
    unchanged,
    stats: { total: rows.length, changed: changes.length, byNewType },
  }

  return NextResponse.json(result)
}

// POST: apply confirmed changes
export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    changes?: { id: string; proposedType: string }[]
  }

  if (!Array.isArray(body.changes) || body.changes.length === 0) {
    return NextResponse.json({ error: 'changes array required' }, { status: 400 })
  }

  const validChanges = body.changes.filter(
    (c) =>
      typeof c.id === 'string' &&
      typeof c.proposedType === 'string' &&
      VALID_TYPES.includes(c.proposedType as NewEventType),
  )

  let applied = 0
  const errors: string[] = []

  for (const change of validChanges) {
    try {
      await updateEvent(change.id, { type: change.proposedType as NewEventType })
      applied++
    } catch (e) {
      errors.push(`${change.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json({ applied, errors })
}
