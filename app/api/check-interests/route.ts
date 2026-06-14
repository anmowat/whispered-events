import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { ALL_TOPICS } from '@/lib/topics'

// Coaching nudge at signup. Now that the chip picker drives most
// submissions toward the curated taxonomy, this endpoint only kicks in
// for free-text answers that won't score well — vague single words,
// pure event-format text, or pure role/seniority text. We coach (not
// reject); the UI lets users keep their answer either way.
//
// On any failure (network, tool-use parse, missing API key) we fail
// open — better to let a slightly weak topics answer through than to
// block the signup flow.

export const maxDuration = 30

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface CheckResponse {
  ok: boolean
  message?: string
  suggestions?: string[]
}

// A small set of suggestions pulled from the curated taxonomy. The LLM
// can pick from here when nudging, instead of inventing keywords.
const SUGGESTION_POOL = ALL_TOPICS.slice(0, 24).join(', ')

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

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      tools: [
        {
          name: 'submit_evaluation',
          description: 'Evaluate whether the topics text is specific enough to match events.',
          input_schema: {
            type: 'object',
            properties: {
              ok: {
                type: 'boolean',
                description: 'true if the topics text contains at least one scorable subject; false if it is pure role/format/exclusion text or too vague to match.',
              },
              message: {
                type: 'string',
                description: 'When ok=false, a short friendly one-sentence nudge explaining why this won\'t score well. Not condescending.',
              },
              suggestions: {
                type: 'array',
                items: { type: 'string' },
                description: 'When ok=false, 3-5 specific topic keywords drawn from the suggestion pool above.',
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
          content: `You evaluate user-provided "Topics" answers for an executive event matching platform.

Our matching algorithm scores topics against the event's name, audience, and description. Useful topics name a subject (function, industry, theme, community). Role/seniority is already pulled from LinkedIn, and event format is filtered separately — neither helps this leg of scoring.

Our curated topic suggestions look like: ${SUGGESTION_POOL}

The user wrote: "${interest}"

Set ok=false (coach, don't hard reject) when the answer is:
- Pure event formats: "Dinners", "Roundtables", "Networking happy hours" — describes shape, not content.
- Pure role/seniority: "CMO events", "VP+", "Senior sales leaders" — already on LinkedIn.
- Pure exclusion criteria: "Not pitch fests", "No fractional people" — useful filter but not a topic.
- Generic/vague: "Flexible", "All types", "Open to anything", "Everything" — no specificity.
- Lone unrelated single word with no anchor (e.g. just "events").

Set ok=true when the answer contains AT LEAST ONE scorable subject — even alongside format or role text. Examples that pass:
- "RevOps and GTM events at $50M+ ARR companies" → "RevOps", "GTM" are scorable
- "CMO events, demand gen" → "demand gen" is scorable
- "AI in B2B sales, founder dinners in SF" → "AI", "B2B sales", "founder" all scorable
- "women in tech" → "women" is scorable (a community angle)
- Single-word topics like "RevOps", "AI", "SaaS", "Healthcare" → fine, they map to real audience tags

When ok=false, set message to a short friendly nudge (e.g. "That looks like role/format — we already handle role from LinkedIn, and format is a separate filter. Add a subject or two and your matches will sharpen up.") and suggestions to 3-5 keywords drawn from the curated suggestions above.`,
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
