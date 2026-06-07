import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getFutureEvents } from '@/lib/airtable'

// Quick "is this interest specific enough" check used at signup. The
// matching algorithm scores interest text against event audience +
// description, so phrases like "flexible", "all types", "networking",
// or event formats ("dinner / conference") tend to produce very few
// matches. Catching these at signup and coaching the user toward
// better keywords saves them from a quiet inbox for weeks.
//
// On any failure (network, tool-use parse, missing API key) we fail
// open — better to let a slightly weak interest through than to block
// the signup flow.

export const maxDuration = 30

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface CheckResponse {
  ok: boolean
  message?: string
  suggestions?: string[]
}

export async function POST(req: NextRequest): Promise<NextResponse<CheckResponse>> {
  let body: { interest?: string }
  try {
    body = (await req.json()) as { interest?: string }
  } catch {
    return NextResponse.json({ ok: true })
  }
  const interest = (body.interest || '').trim()
  // Empty / skipped is fine — preference defaults to 1.0 (neutral) and
  // the user's already-on-LinkedIn function + seniority still drive
  // matches. No coaching needed.
  if (!interest) {
    return NextResponse.json({ ok: true })
  }

  let audienceList = ''
  try {
    const events = await getFutureEvents()
    const tags = new Set<string>()
    for (const e of events) {
      for (const tag of e.audience) {
        const trimmed = tag.trim()
        if (trimmed) tags.add(trimmed)
      }
    }
    audienceList = Array.from(tags).slice(0, 80).join(', ')
  } catch (e) {
    console.error('check-interests: getFutureEvents failed, evaluating without audience context:', e)
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      tools: [
        {
          name: 'submit_evaluation',
          description: 'Evaluate whether the interest text is specific enough to match events.',
          input_schema: {
            type: 'object',
            properties: {
              ok: {
                type: 'boolean',
                description: 'true if the interest is specific enough to match well; false if too vague.',
              },
              message: {
                type: 'string',
                description: 'When ok=false, a short one-sentence note explaining why this answer won\'t match many events. Friendly, not condescending.',
              },
              suggestions: {
                type: 'array',
                items: { type: 'string' },
                description: 'When ok=false, 3-5 specific keywords drawn from or aligned with the audience tags above that would match better. No labels, just the bare keywords.',
              },
            },
            required: ['ok'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_evaluation' },
      messages: [
        {
          role: 'user',
          content: `You evaluate user-provided "event interest" answers for an executive event matching platform.

Our event database tags each event with an Audience field. Here is a representative sample of audience tags from upcoming events:
${audienceList || '(unavailable)'}

Our matching algorithm scores the user's interest text against event audience + description. Specific role/topic/industry keywords match well; vague answers don't.

The user wrote: "${interest}"

Examples of answers that are TOO VAGUE (set ok=false):
- "Flexible" / "All types" / "Open to anything" — no specificity
- "Networking" / "Connecting with people" — every event is networking
- Just event formats: "Dinner, conferences, workshops" — describes shape, not content
- Generic seniority alone without context: "C-level events"
- One-word generic terms: "GTM" alone is borderline; "RevOps" or "AI" are fine because they map to real audience tags

Examples that are FINE (set ok=true):
- "RevOps and GTM events at $50M+ ARR companies"
- "CMO, marketing leadership, demand gen"
- "AI in B2B sales, founder dinners in SF"
- "Enterprise SaaS sales, customer success leaders"

When ok=false, set message to a short friendly note (e.g. "Answers like this don't usually match many events — they're too broad for our matching algorithm to anchor on.") and suggestions to 3-5 specific keywords pulled from or aligned with the audience tags above.`,
        },
      ],
    })

    const toolUse = message.content.find((c) => c.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') {
      return NextResponse.json({ ok: true })
    }
    const input = toolUse.input as {
      ok?: boolean
      message?: string
      suggestions?: string[]
    }
    if (input.ok === false) {
      return NextResponse.json({
        ok: false,
        message: (input.message || '').trim() || undefined,
        suggestions: Array.isArray(input.suggestions)
          ? input.suggestions.map((s) => String(s).trim()).filter(Boolean).slice(0, 5)
          : undefined,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('check-interests: LLM call failed:', err)
    return NextResponse.json({ ok: true })
  }
}
