import Anthropic from '@anthropic-ai/sdk'
import { AirtableEvent, AirtableUser } from './airtable'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function scoreEventUser(
  event: AirtableEvent,
  user: AirtableUser
): Promise<{ score: number; reason: string }> {
  const prompt = `You are matching a professional event to a potential attendee. Score the relevance.

Event:
- Name: ${event.name}
- Type: ${event.type}
- Audience: ${event.audience.join(', ') || 'Not specified'}
- Description: ${event.description || 'Not provided'}

Attendee profile:
- Function/Role: ${user.function}
- Seniority: ${user.seniority}
- Company size: ${user.companySize}
- Event interests: ${user.interest}
- Affiliation: ${user.affiliation}

Return ONLY valid JSON with no markdown: {"score": 0.0-1.0, "reason": "one sentence"}`

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''

  try {
    const parsed = JSON.parse(text) as { score: number; reason: string }
    return {
      score: Math.min(1, Math.max(0, Number(parsed.score) || 0)),
      reason: String(parsed.reason || ''),
    }
  } catch {
    return { score: 0, reason: 'Parse error' }
  }
}
