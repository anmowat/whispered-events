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

Reply with ONLY the category name, nothing else.`

// Returns null when the classification could not be obtained. Callers must
// treat null as "no opinion" and leave the event alone — this used to return
// 'Other' on any error, which meant a transient 429 during the dry run showed
// up as a proposed reclassification of a correctly-typed event to 'Other'.
async function classifyEvent(
  anthropic: Anthropic,
  name: string,
  description: string,
): Promise<NewEventType | null> {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      temperature: 0,
      // The rubric is identical on every call, so it goes in a cached system
      // block; only the per-event text varies and lives in the user message.
      system: [
        { type: 'text' as const, text: CLASSIFY_PROMPT, cache_control: { type: 'ephemeral' as const } },
      ],
      messages: [
        {
          role: 'user',
          content: `Event name: ${name}\nDescription: ${description || '(no description)'}`,
        },
      ],
    })
    const raw = (msg.content[0] as { type: string; text: string }).text?.trim() ?? ''
    return VALID_TYPES.find((t) => raw.toLowerCase().startsWith(t.toLowerCase())) ?? null
  } catch (err) {
    console.error(`reclassify: classify failed for "${name}"`, err)
    return null
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
  failed: { id: string; name: string }[]
  stats: { total: number; changed: number; failed: number; byNewType: Record<string, number> }
}

// GET: dry-run — returns proposed changes without writing anything
export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // This makes one LLM call per row, so the scan is date-bounded by default.
  // Reclassifying long-past events has no practical value and the unbounded
  // version re-paid for the entire events table on every dry run.
  // ?all=1 restores the full-history scan; ?sinceDays=N tunes the window.
  const all = req.nextUrl.searchParams.get('all') === '1'
  const sinceDays = Number(req.nextUrl.searchParams.get('sinceDays')) || 90
  const cutoff = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10)

  const supabase = getSupabase()
  let query = supabase
    .from('events')
    .select('id, name, type, description, date, location')
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
    .not('name', 'is', null)
  if (!all) query = query.gte('date', cutoff)
  const { data, error } = await query.order('date', { ascending: false }).limit(5_000)

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
  // Events whose classification call failed — surfaced so a partial scan
  // doesn't read as a complete one.
  const failed: { id: string; name: string }[] = []

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
      // null = classification failed. Leave the event alone rather than
      // proposing a change we have no basis for.
      if (proposed === null) {
        failed.push({ id: row.id, name: row.name ?? '' })
      } else if (proposed !== current) {
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

  if (failed.length) {
    console.warn(`reclassify: ${failed.length} of ${rows.length} events could not be classified`)
  }

  const result: ReclassifyResult = {
    changes,
    unchanged,
    failed,
    stats: { total: rows.length, changed: changes.length, failed: failed.length, byNewType },
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
