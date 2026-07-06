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
  const today = new Date().toISOString().split('T')[0]
  const prompt = `You are an event information extractor. Extract structured event data from the following content.

Today's date is ${today} (YYYY-MM-DD). When the content shows a date without a year (e.g. "Jun 2", "Tuesday, Jun 2", "next Tuesday"), interpret it as the next occurrence on or after today and fill in the year yourself. Do not skip the date field just because the year is implicit.

${sourceUrl ? `Source URL: ${sourceUrl}` : ''}

Content:
${content}

Extract and return a JSON object with these fields (omit fields you cannot determine):
- name: Short event name, maximum 6 words
- type: One of exactly: "Conference", "Dinner", "Virtual", "Other" — pick the best fit based on context
- date: ISO date string (YYYY-MM-DD) of the event start date. If the source shows a year-less date like "Jun 2" or "Tuesday, Jun 2", combine it with the next applicable year based on today's date.
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

export interface ProfileExperience {
  position?: string
  started_on?: string
  ended_on?: string
  duration_in_months?: number
  company?: string
  company_size?: string
}

export interface ProfileClassification {
  function: string
  seniority: string
}

export async function classifyProfileFunctionAndSeniority(
  experiences: ProfileExperience[],
  headline: string,
): Promise<ProfileClassification> {
  const fallback: ProfileClassification = { function: 'n/a', seniority: 'n/a' }

  const rolesJson = JSON.stringify(
    experiences.slice(0, 10).map((e) => ({
      position: e.position || '',
      ...(e.started_on ? { started_on: e.started_on } : {}),
      ...(e.ended_on ? { ended_on: e.ended_on } : {}),
      ...(e.duration_in_months != null ? { duration_in_months: e.duration_in_months } : {}),
      ...(e.company ? { company: e.company } : {}),
      ...(e.company_size ? { company_size: e.company_size } : {}),
    })),
    null,
    2,
  )

  const prompt = `You are a B2B go-to-market data classifier. Given a LinkedIn experience list and headline, return ONLY a JSON object with two fields: "function" and "seniority". No explanation, no markdown.

Headline: ${headline || '(none)'}

Roles (index 0 = most recent):
${rolesJson}

---
OUTPUT 1 — FUNCTION
Determine the lead's job function from their most recent roles and title.

Rules:
- Consider the most recent 3 roles.
- Select the function based on the role with the longest duration_in_months among those 3. If duration data is absent, use the most recent non-ignored role.
- Ignore roles where the title includes: advisor, consultant, board member, fractional, member (as a standalone word).
- If no clear match, return "n/a".

Function definitions (use ONLY these exact labels):
- Sales: CRO, Chief Revenue Officer, Worldwide Sales, Global Sales, Head of Sales, Director of Sales, Chief Sales Officer, Channel Sales, VP of Sales, Sales Director, Sales Development, Partnership, Enterprise Sales, SMB Sales, Sales Engineering, Value Engineering, Solution Consulting, Solution Engineering, Value Consulting, Business Development
- Marketing: Revenue Marketing, Event Marketing, Content Marketing, Performance Marketing, Digital Marketing, Lifecycle Marketing, Customer Marketing, Partner / Channel Marketing, Integrated Marketing, CMO, Demand Generation, Field Marketing, Product Marketing, Brand Marketing, Growth Marketing, Executive Engagement
- Customer Success: CCO, Chief Customer Officer, VP of Customer Success, Customer Experience, Customer Success, Professional Services, Tech-Touch, Support, Account Management, Retention, Renewal
- RevOps: Sales Operations, Revenue Operations, Sales Strategy, Marketing Operations, Enablement, GTM Operations, Customer Success Operations, GTM Systems, Post-Sale Operations, Revenue Strategy, Global Sales Enablement, Marketing Manager
- Engineering: Engineering
- Finance: Finance
- HR: HR
- IT: IT
- Legal: Legal
- Product: Product
- Security: Security
- Board: Board
- CEO/Founder: Founder, CEO
- Other: Other

---
OUTPUT 2 — SENIORITY
Rules:
- Ignore roles where the title includes: advisor, consultant, board member, fractional, member (as a standalone word).
- Select the seniority for the most recent role with duration_in_months >= 12 where we can determine a seniority. If no duration data is available, use the most recent role with a determinable seniority.
- Only consider roles from the past 10 years.
- If no clear match, return "n/a".

Seniority levels (use ONLY these exact labels):
- C-Level: CEO, Chief, COO, CFO, CTO (and equivalents)
- VP: Vice President, VP, General Manager
- Director: Director, Head of
- Lead: Lead, Team Lead, Principal
- Manager: Manager, Senior Manager
- Junior: Specialist, Engineer, Account Executive, or ambiguous/entry-level titles (Contributor, Community, Advocate, Builder, Assistant, Scholar, etc.)

Additional rules:
- Use only the actual job title — do not infer from context.
- If company_size indicates fewer than 50 employees (e.g. "1-10", "11-50"), downgrade one level (C-Level → VP, VP → Director, Director → Manager, Manager → Lead, Lead → Junior). Never upgrade.
- If the most recent qualified role is "Partner", skip it and evaluate the next qualified role.
- If a title is ambiguous, fall back to the previous qualified role and retry. Continue until a classifiable title is found.
- Only return "n/a" if all qualified roles have been checked and none can be clearly classified.

---
Return ONLY valid JSON. Example: {"function":"Sales","seniority":"VP"}`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as ProfileClassification
    return {
      function: typeof parsed.function === 'string' ? parsed.function : 'n/a',
      seniority: typeof parsed.seniority === 'string' ? parsed.seniority : 'n/a',
    }
  } catch (e) {
    console.error('classifyProfileFunctionAndSeniority error:', e instanceof Error ? e.message : String(e))
    return fallback
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
