import Anthropic from '@anthropic-ai/sdk'
import { ParsedEvent, EventType } from './types'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const EVENT_TYPES: EventType[] = ['Conference', 'Dinner', 'Virtual', 'Other']

export async function parseEventContent(
  content: string,
  sourceUrl?: string
): Promise<ParsedEvent> {
  const prompt = `You are an event information extractor. Extract structured event data from the following content.

${sourceUrl ? `Source URL: ${sourceUrl}` : ''}

Content:
${content}

Extract and return a JSON object with these fields (omit fields you cannot determine):
- name: Short event name, maximum 6 words
- type: One of exactly: "Conference", "Dinner", "Virtual", "Other" — pick the best fit based on context
- date: ISO date string (YYYY-MM-DD) of the event start date
- location: City, state/country or "Virtual" (e.g. "New York, NY" or "San Francisco, CA")
- description: A 2-sentence description of the event and the intended audience that would be shared with potential attendees
- link: The canonical URL for the event (use the source URL if appropriate)
- audience: Array of professional role/title strings who this event targets (e.g. ["CROs", "CMOs", "Revenue Leaders"])

Return ONLY valid JSON, no markdown, no explanation. Example:
{"name":"GTM Summit 2025","type":"Conference","date":"2025-09-15","location":"New York, NY","description":"...","link":"https://...","audience":["CROs","CMOs"]}`

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const text =
    message.content[0].type === 'text' ? message.content[0].text : ''

  try {
    // Strip markdown code fences if present
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(cleaned) as ParsedEvent

    // Validate type
    if (parsed.type && !EVENT_TYPES.includes(parsed.type)) {
      parsed.type = 'Other'
    }

    // Ensure link is set
    if (!parsed.link && sourceUrl) {
      parsed.link = sourceUrl
    }

    return parsed
  } catch (e) {
    console.error('claude parse error:', e instanceof Error ? e.message : String(e))
    console.error('claude raw response:', text)
    return { link: sourceUrl }
  }
}

// Used by the Partner apply chat to show "we have your audience" before
// asking for event volume. Reply must echo the audience the partner just
// named — generic "right people" copy felt empty. Returns an audience-aware
// template on any error so the chat flow never blocks AND the reply still
// references what the partner said.
export async function generateAudienceAck(audience: string): Promise<string> {
  const trimmed = audience.trim()
  if (!trimmed) {
    return 'That is great. We have the right people on our platform and look forward to connecting you with them.'
  }
  // Audience-aware fallback used on any LLM error. Echoing the raw input
  // is better than generic copy because the whole point of the ack is to
  // mirror back what the partner just told us.
  const fallback = `That is great. We have ${trimmed} on our platform and look forward to connecting you with the right ones.`
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [
        {
          role: 'user',
          content: `A potential partner just described their target audience as: "${trimmed}"

Reply with 1-2 short, warm sentences that:
1. Acknowledge their answer warmly (do NOT start with "Great" or "Awesome").
2. Explicitly reference the SAME audience they just named. Translate the literal roles into a natural seniority-and-function plural noun phrase (e.g. "CROs" → "senior revenue leaders", "CMOs and VPs of Marketing" → "senior marketing leaders", "VCs" → "investors", "founders of pre-seed startups" → "early-stage founders"). If the audience they named is already a natural phrase, you may use it as-is. The audience phrase MUST appear in your reply.
3. Position Whispered Events as already having those exact people on platform and wanting to connect them with the right ones.

Do NOT lecture about what this audience cares about. Do NOT explain what the audience does or prioritizes. Do not use emojis. Return ONLY the sentence(s).

Example for input "CROs": "That is great. We have senior revenue leaders on our platform and look forward to connecting you with the right ones."
Example for input "early-stage fintech founders": "That is great. We have early-stage fintech founders on our platform and look forward to connecting you with the right ones."`,
        },
      ],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    return text || fallback
  } catch (e) {
    console.error('generateAudienceAck error:', e instanceof Error ? e.message : String(e))
    return fallback
  }
}
