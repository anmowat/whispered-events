import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { AirtableEvent, AirtableUser } from './airtable'
import { withinMiles } from './geocode'
import { VIRTUAL_LOCATION_RE } from './types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MAX_MILES = 100
const FREE_TEXT_CAP = 500
// 1 (location) × 1.5 (audience) × 1.5 (quality A) × 1.5 (preferences).
const MAX_SCORE = 3.375
const QUALITY_MULTIPLIER: Record<'A' | 'Polish' | 'B' | 'C', number> = {
  A: 1.5,
  Polish: 1.0,
  B: 0.5,
  C: 0.25,
}

// Bumped any time the scoring rubric / prompt / formula changes so the
// inputs hash on every cached row turns stale. The admin rescore-missing
// endpoint then picks them up and refreshes under the new model.
const MATCHING_VERSION = 3

export type SkippedReason = 'grade_c' | 'location_zero'

export interface ScoreResult {
  score: number
  matchPercent: number
  location: number
  audience: number | null
  quality: number
  preferences: number | null
  reason: string
  skippedReason: SkippedReason | null
  inputsHash: string
}

export function isMatchEligible(user: AirtableUser): boolean {
  return Boolean(user.grade && user.function?.trim() && user.seniority?.trim())
}

export function computeInputsHash(event: AirtableEvent, user: AirtableUser): string {
  const payload = {
    version: MATCHING_VERSION,
    event: {
      audience: event.audience ?? [],
      type: event.type ?? '',
      description: event.description ?? '',
      lat: event.lat ?? null,
      lng: event.lng ?? null,
    },
    user: {
      function: user.function ?? '',
      seniority: user.seniority ?? '',
      fullExp: user.fullExp ?? '',
      companySize: user.companySize ?? '',
      employment: user.employment ?? '',
      interest: user.interest ?? '',
      grade: user.grade ?? '',
      lat: user.lat ?? null,
      lng: user.lng ?? null,
    },
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function cap(s: string, n = FREE_TEXT_CAP): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) : s
}

function isVirtualEvent(event: AirtableEvent): boolean {
  if (event.type === 'Virtual') return true
  return VIRTUAL_LOCATION_RE.test(event.location || '')
}

export function computeLocationScore(event: AirtableEvent, user: AirtableUser): 0 | 1 {
  // Virtual events are no longer accepted; treat any that slip through as location=0.
  if (isVirtualEvent(event)) return 0
  if (event.lat == null || event.lng == null) return 0
  if (user.lat == null || user.lng == null) return 0
  return withinMiles({ lat: user.lat, lng: user.lng }, { lat: event.lat, lng: event.lng }, MAX_MILES) ? 1 : 0
}

function buildToPercent(score: number): number {
  return Math.max(0, Math.min(100, Math.round((score / MAX_SCORE) * 100)))
}

function emptyResult(opts: {
  location: 0 | 1
  quality: number
  reason: string
  skippedReason: SkippedReason | null
  inputsHash: string
}): ScoreResult {
  return {
    score: 0,
    matchPercent: 0,
    location: opts.location,
    audience: null,
    quality: opts.quality,
    preferences: null,
    reason: opts.reason,
    skippedReason: opts.skippedReason,
    inputsHash: opts.inputsHash,
  }
}

interface AudiencePreferenceResult {
  audience: number
  preferences: number
  reason: string
}

async function callLLM(
  event: AirtableEvent,
  user: AirtableUser,
  fixedSide: 'event' | 'user',
): Promise<AudiencePreferenceResult> {
  const description = cap(event.description || 'Not provided')
  const audienceList = event.audience.join(', ') || 'Not specified'
  const interest = cap(user.interest || '')

  const eventBlock = `Event:
- Name: ${event.name}
- Type: ${event.type}
- Audience: ${audienceList}
- Description: ${description}`

  const userBlock = `Attendee profile:
- Function/Role: ${user.function}
- Seniority: ${user.seniority}
- Full experience: ${cap(user.fullExp) || 'Not provided — ignore in scoring'}
- Company size: ${user.companySize || 'Not specified — ignore in scoring'}
- Employment: ${user.employment || 'Not specified — ignore in scoring'}
- Event interests: ${interest || 'Not stated — return preferences=1.0 (neutral)'}`

  const instructions = `Score how well this event fits this attendee. Be CALIBRATED — both scores have explicit anchors below. Don't be conservative for safety; the rubric is the floor.

Return three values via the submit_score tool:

1. "audience" (0.0–1.5): how the event's stated Audience and Type aligns with the attendee's Function and Seniority. Use this rubric — do not invent intermediate logic:
   • 1.5 — Event audience literally names this attendee's function AND seniority (e.g. event audience "Marketing VP/Directors, CMO" for a C-level Marketing attendee). Treat "Founder" as synonymous with "CEO" for the function-family check.
   • 1.2 — Event audience literally names the function OR the seniority, but not both.
   • 0.9 — Same function family, adjacent seniority only (e.g. VP Sales at a CRO dinner; Director Marketing at a CMO event; Founder at a CEO-only dinner since Founder/CEO share a function family). Different functions at the same seniority level do NOT count as adjacent.
   • 0.5 — Tangential overlap. This is the right tier when the audience names a SPECIFIC C-suite role (CEOs, CMOs, CROs, CFOs, GCs) and the attendee holds a DIFFERENT C-suite role (e.g. a CMO at a CEOs-only dinner; a VP Sales at a CMO event). Cross-function executive overlap is tangential, not adjacent.
   • 0.0 — Wrong audience entirely.

   Hard rule: when the event audience names a specific C-suite role (CEOs, CMOs, CROs, CFOs, GCs, etc.), only attendees in that exact role family — plus Founders for CEO events — qualify for ≥0.9. Every other C-suite function is 0.5 (tangential), not 0.9.

   Industry context (SaaS vs VC vs services etc.) cannot drop the score by more than one tier. Function + seniority overlap dominates.

2. "preferences" (0.0–1.5): how the event matches the attendee's stated Event interests. Use this rubric:
   • 1.5 — Stated interest matches the event name, audience, or description literally or near-literally (e.g. interest "RevOps events" + event "RevOps Leaders Dinner" → 1.5; interest "marketing" + event audience includes "CMO/Marketing VP" → 1.5).
   • 1.2 — Strong semantic match (interest "GTM" + event for "Sales + Marketing leaders").
   • 1.0 — Interests not stated OR neutral (no signal either way).
   • 0.5 — Weak overlap (one tangential keyword).
   • 0.0 — Attendee explicitly excluded this kind of event.

3. "reason" (one sentence): the dominant factor driving the score — literal overlap, adjacency, or mismatch.`

  // Cache the larger fixed-side block so fanout calls hit the cache.
  const systemBlocks = fixedSide === 'event'
    ? [
        { type: 'text' as const, text: eventBlock, cache_control: { type: 'ephemeral' as const } },
        { type: 'text' as const, text: instructions },
      ]
    : [
        { type: 'text' as const, text: userBlock, cache_control: { type: 'ephemeral' as const } },
        { type: 'text' as const, text: instructions },
      ]

  const userMessage = fixedSide === 'event' ? userBlock : eventBlock

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: systemBlocks,
    tools: [
      {
        name: 'submit_score',
        description: 'Submit the audience and preferences scores for this event-attendee pair.',
        input_schema: {
          type: 'object',
          properties: {
            audience: { type: 'number', minimum: 0, maximum: 1.5 },
            preferences: { type: 'number', minimum: 0, maximum: 1.5 },
            reason: { type: 'string' },
          },
          required: ['audience', 'preferences', 'reason'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_score' },
    messages: [{ role: 'user', content: userMessage }],
  })

  const toolUse = message.content.find((c) => c.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('matching: model did not return tool_use')
  }
  const input = toolUse.input as { audience: number; preferences: number; reason: string }
  return {
    audience: Math.max(0, Math.min(1.5, Number(input.audience) || 0)),
    preferences: Math.max(0, Math.min(1.5, Number(input.preferences) || 0)),
    reason: String(input.reason || ''),
  }
}

export async function scoreEventUser(
  event: AirtableEvent,
  user: AirtableUser,
  fixedSide: 'event' | 'user' = 'event',
): Promise<ScoreResult> {
  const inputsHash = computeInputsHash(event, user)

  if (!isMatchEligible(user)) {
    // Defensive — callers should filter ineligible users before calling.
    throw new Error(`scoreEventUser: user ${user.email} is not eligible (missing required fields)`)
  }

  const grade = user.grade ?? 'Polish'
  const quality = QUALITY_MULTIPLIER[grade]

  // Short-circuit 1: Grade C cannot reach the notify threshold.
  if (grade === 'C') {
    return emptyResult({
      location: 0,
      quality,
      reason: 'Skipped: grade C cannot reach notify threshold',
      skippedReason: 'grade_c',
      inputsHash,
    })
  }

  // Short-circuit 2: Location = 0
  const location = computeLocationScore(event, user)
  if (location === 0) {
    return emptyResult({
      location: 0,
      quality,
      reason: 'Skipped: user not within 100 miles of event city',
      skippedReason: 'location_zero',
      inputsHash,
    })
  }

  // Short-circuit 3: empty interest → skip the LLM's preferences leg, but we still need audience.
  // Run one combined LLM call regardless; the prompt instructs it to return preferences=1.0
  // when interest is missing. This keeps the code paths uniform.
  const llm = await callLLM(event, user, fixedSide)

  const score = location * llm.audience * quality * llm.preferences
  return {
    score,
    matchPercent: buildToPercent(score),
    location,
    audience: llm.audience,
    quality,
    preferences: llm.preferences,
    reason: llm.reason,
    skippedReason: null,
    inputsHash,
  }
}
