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
