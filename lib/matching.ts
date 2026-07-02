import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { AirtableEvent, AirtableUser } from './airtable'
import { haversineMiles } from './geocode'
import { VIRTUAL_LOCATION_RE, EMPLOYMENT_OPTIONS, COMPANY_SIZE_OPTIONS } from './types'
import { SENIORITY_OPTIONS } from './seniority'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Wraps an Anthropic call with retry-on-429 / 5xx. Backoff is short and
// linear (1s → 3s → 9s) so a single rate-limited LLM call doesn't hold
// the function open for long, but bursty load (e.g. process-matches'
// 50-wide parallel batch) gets a chance to clear. After 3 attempts the
// error bubbles to the caller, which already catches and logs.
async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  const delays = [1_000, 3_000, 9_000]
  let lastErr: unknown
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const status = (err as { status?: number })?.status
      const retryable = status === 429 || (typeof status === 'number' && status >= 500)
      if (!retryable || attempt === delays.length) break
      await new Promise((r) => setTimeout(r, delays[attempt]))
    }
  }
  throw lastErr
}

const MAX_MILES = 150
const FREE_TEXT_CAP = 500
// 1.1 (location ≤10mi) × 1.5 (audience) × 1.5 (quality A) × 1.5 (preferences).
const MAX_SCORE = 3.7125
const QUALITY_MULTIPLIER: Record<'A' | 'Polish' | 'B' | 'C', number> = {
  A: 1.5,
  Polish: 1.0,
  B: 0.5,
  C: 0.25,
}

// Bumped any time the scoring rubric / prompt / formula changes so the
// inputs hash on every cached row turns stale. The admin rescore-missing
// endpoint then picks them up and refreshes under the new model.
// v14: adds seniority/employment/company-size gates; refocuses audience
// LLM on function only; includes event filter fields in hash.
const MATCHING_VERSION = 14

// The radius constant lives in lib/geocode.ts (client-safe — no
// Anthropic SDK or other server-only deps in that module). Re-export
// here so existing imports of `NEARBY_RADIUS_MILES` from '@/lib/matching'
// still resolve, but client components should import from '@/lib/geocode'
// directly to avoid pulling this whole module into the browser bundle.
export { NEARBY_RADIUS_MILES } from './geocode'

export type SkippedReason = 'grade_c' | 'location_zero' | 'women_only_audience' | 'seniority_mismatch' | 'employment_mismatch' | 'company_size_mismatch'

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
      seniority: event.seniority ?? [],
      employment: event.employment ?? [],
      companySize: event.companySize ?? [],
    },
    user: {
      function: user.function ?? '',
      seniority: user.seniority ?? '',
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

function locationMultiplier(dist: number): number {
  if (dist <= 10) return 1.1
  if (dist <= 20) return 1.05
  if (dist <= 30) return 1.0
  if (dist <= 60) return 0.85
  if (dist <= 150) return 0.7
  return 0
}

export function computeLocationScore(event: AirtableEvent, user: AirtableUser): number {
  // Virtual events are no longer accepted; treat any that slip through as location=0.
  if (isVirtualEvent(event)) return 0
  if (event.lat == null || event.lng == null) return 0
  if (user.lat == null || user.lng == null) return 0
  const dist = haversineMiles({ lat: user.lat, lng: user.lng }, { lat: event.lat, lng: event.lng })
  return locationMultiplier(dist)
}

function buildToPercent(score: number): number {
  return Math.max(0, Math.min(100, Math.round((score / MAX_SCORE) * 100)))
}

function emptyResult(opts: {
  location: number
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
- Company size: ${user.companySize || 'Not specified — ignore in scoring'}
- Employment: ${user.employment || 'Not specified — ignore in scoring'}
- Topics they want events about: ${interest || 'Not stated — return preferences=1.0 (neutral)'}`

  const instructions = `Score how well this event fits this attendee. Be CALIBRATED — both scores have explicit anchors below. Don't be conservative for safety; the rubric is the floor.

Return three values via the submit_score tool:

1. "audience" (0.0–1.5): how the event's stated Audience and Type aligns with the attendee's Function. Seniority is handled separately — score function fit only. LITERAL function naming (or strict C-suite alias) is the only path to 1.2+. Broad-role aliases are soft signal. Use this rubric — do not invent intermediate logic:
   • 1.5 — Event audience LITERALLY names this attendee's function (e.g. audience "CMOs, Marketing Leaders" for a Marketing attendee, or "CROs, Revenue Leaders" for a Sales attendee). Strict C-suite aliases below count as literal.
   • 1.2 — Event audience uses a "[Function] Leaders/Executives/VPs/Directors/Heads" construction that directly names the function, or a strict C-suite alias that clearly implies the function. The function must actually match — a CMO at an event whose audience names "VPs of Marketing" lands here. A CTO at a CMO event does NOT — that's wrong audience (0.0).
   • 0.8 — Broad-role alias only: the attendee qualifies via one of the broad-role aliases below (e.g. RevOps under "GTM Leaders", Customer Success under "Revenue Leaders", Design under "Product Leaders") with no literal function naming. Close to the audience but not literally named.
   • 0.6 — Same function family, adjacent (e.g. VP Sales at a CRO dinner where function is close but not the named focus; Marketing function at a RevOps-focused event). Different function families do NOT qualify.
   • 0.0 — Wrong audience entirely. Covers cross-function mismatches (CTO at a CMO event, VP Sales at a CMO event). There is no "tangential overlap" tier — if the function family doesn't match and there's no broad-role-alias path, it's wrong audience.

   C-suite function-family aliases (STRICT — count as literal naming for the 1.5 / 1.2 tiers): when the attendee's Function + Seniority matches one of these, treat the corresponding C-title in the event audience as a LITERAL match:
     • Founder ≡ CEO (and Co-Founder ≡ CEO)
     • C-Level Sales / C-Level Revenue ≡ CRO
     • C-Level Marketing ≡ CMO
     • C-Level Engineering / C-Level Technology ≡ CTO
     • C-Level Finance ≡ CFO
     • C-Level Operations ≡ COO
     • C-Level Product ≡ CPO
     • C-Level Legal / C-Level Counsel ≡ GC
     • C-Level People / C-Level HR ≡ CHRO / CPO-People

   Broad-role aliases (SOFT — cap at 0.8, NOT literal): when the event audience uses one of these phrases, interpret it as inclusive of the listed functions at any senior level (Director / VP / C-Level), but score the match at 0.8 not 1.2:
     • "GTM Leaders" / "Revenue Leaders" / "Go-to-Market Leaders" → Sales, RevOps, Marketing, Customer Success
     • "Engineering Leaders" → Engineering, Platform, Infrastructure, DevOps, Data
     • "Product Leaders" → Product Management, Design, Product Marketing
     • "Operations Leaders" → Operations, Supply Chain, Strategy

   Founder/CEO oversight exception: Founders and CEOs oversee every function in their company. The strict alias "Founder ≡ CEO" credits 1.5 / 1.2 only when the audience LITERALLY names "Founder(s)", "Co-Founder", or "CEO". Otherwise, when the audience targets a senior function whose holders would report into a Founder/CEO — other C-suite roles (CMO, CRO, CFO, CTO, CPO, COO, etc.), VPs / Heads of any function (Sales, Marketing, Engineering, RevOps, etc.), broad-role aliases ("GTM Leaders", "Revenue Leaders", "Engineering Leaders", etc.), or broad senior-functional groups ("Anyone in GTM", "Anyone in Engineering") — a Founder/CEO scores 0.8, not 0.0. Rationale: a Founder/CEO can speak to and learn from any dinner where their direct reports would be invited. This exception applies ONLY to Founders/CEOs. It does NOT generalize to other C-suite — a CTO at a "CMOs only" dinner is wrong audience (0.0), a CMO at a "CROs only" dinner is 0.0. Cross-function C-suite with no oversight relationship is 0.0.

   Multi-function attendees: when the Function field lists multiple values (e.g. "RevOps, Sales"), score against the SINGLE BEST match across them. Pick the function that aligns most strongly with the event audience, ignore the rest.

   Hard rule — applies ONLY to single-role audiences (e.g. "CEOs only", "CMOs only", "CROs and Founders only"): only attendees mapping to that exact role family via the STRICT C-suite aliases above qualify for ≥1.2. Every other C-suite function is 0.0 (wrong audience), not partial credit.

   Multi-role audiences (event lists 3+ distinct roles, e.g. "CROs, CMOs, GTM Leaders, Founders"): an attendee who matches one of the listed roles via a STRICT C-suite alias scores per the literal tiers (1.5 / 1.2). An attendee who matches ONLY via a broad-role alias caps at 0.8.

   Industry context (SaaS vs VC vs services etc.) cannot drop the score by more than one tier. Function + seniority overlap dominates.

2. "preferences" (0.0–1.5): how the event aligns with the topics the attendee said they want events about. Compare against the event's name, audience, and description. DENSITY matters — score the SHARE of the attendee's scorable topics that match, not just whether any one of them does.

   Treat as neutral (ignore for this leg, do not penalize, and do not count against the scorable-topic denominator): topics that are actually role/seniority (e.g. "CMO events", "VP+", "senior sales leaders"), event formats (e.g. "dinners", "networking", "roundtables"), or exclusion criteria. Role/seniority is already scored in the audience leg above; format isn't on the event-side rubric.

   • 1.5 — Multiple stated topics literally match the event (≥2 of the attendee's scorable topics map to the event's name/audience/description). OR a single literal match when the attendee's scorable topic list is very short (≤2 topics) and the match is dominant.
   • 1.2 — Single literal topic match against a medium topic list (3 scorable topics) — strong but not overwhelming.
   • 1.0 — No topics stated, OR only role/format/exclusion text given and no scorable topic remains. ALSO: single literal topic match in a longer list (4+ scorable topics) — needle in haystack. ALSO: strong semantic match (topic "GTM" + event for "Sales + Marketing leaders"; topic "AI" + an event explicitly about Agentic AI) regardless of list length.
   • 0.7 — Genuine tangential overlap (one weak keyword that maps loosely — e.g. topic "GTM" against an event about "Marketing Operations"; same neighborhood, not the same thing).
   • 0.4 — Topics stated but none match this event at all (off-topic, not opposed). Floor for "we have signal about what they want; this isn't it."

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

  // Retry on Anthropic 429s and transient 5xx. Backoff is intentionally
  // short — process-matches fans out 50 LLM calls in parallel, and a
  // version bump can put thousands of pairs in the queue simultaneously.
  // Without this, the first 429 ends the call → scoreAndNotify swallows
  // it → the match never gets written → dashboard polling never
  // converges. Three attempts with 1s/3s/9s backoff covers brief rate-
  // limit pressure without holding the function open for long.
  const message = await callWithRetry(() =>
    anthropic.messages.create({
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
    }),
  )

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

// Women-only event gate. Fires when the event's audience field
// mentions "women" anywhere (host-controlled — the host said it, we
// honor it). The attendee is excluded only when their Topics field
// does NOT include a Women-coded term AND their first name maps to
// a high-confidence male entry in lib/gender. Ambiguous + non-listed
// names default to inclusion so we err toward reach. Topics opt-in
// always wins as the explicit override.
//
// When the gate fires we short-circuit before the LLM call: returns
// audience = 0.0, preferences = 1.0 (neutral), and a 'women_only_audience'
// skipped reason. Saves tokens and is deterministic.
function isWomenOnlyAudience(audience: string[]): boolean {
  return audience.some((tag) => /\bwomen\b|\bwomxn\b|\bfemale\b/i.test(tag))
}

function topicsIncludeWomen(interest: string): boolean {
  return /\bwomen\b|\bwomxn\b|\bfemale\b/i.test(interest || '')
}

function shouldExcludeFromWomenOnlyEvent(
  event: AirtableEvent,
  user: AirtableUser,
): boolean {
  if (!isWomenOnlyAudience(event.audience)) return false
  // Topic opt-in is the only gate: women-only events match users who
  // explicitly picked Women as a topic. No gender inference — names
  // are noisy, and an explicit topic is the user's stated intent.
  return !topicsIncludeWomen(user.interest)
}

// Broad-role aliases that the rubric says cap audience at 0.8 — but
// the LLM keeps under-applying them when Director-level functions
// show up at "Revenue Leaders" / "GTM Leaders" / etc. events. This
// deterministic floor enforces the rubric's intent: if the event's
// audience uses a broad-role term AND the user's function is in that
// alias's list AND they're at Director+ seniority, the audience leg
// is at least 0.8 regardless of what the model returned.
const BROAD_ALIAS_FLOORS: Array<{ audience: RegExp; functions: RegExp }> = [
  {
    audience: /\b(gtm|revenue|go.?to.?market|growth)\s+leader/i,
    functions: /\b(sales|revops|rev ops|marketing|customer success|cs)\b/i,
  },
  {
    audience: /\bengineering\s+leader/i,
    functions: /\b(engineering|platform|infrastructure|devops|data)\b/i,
  },
  {
    audience: /\bproduct\s+leader/i,
    functions: /\b(product|design|product marketing)\b/i,
  },
  {
    audience: /\b(operations|ops)\s+leader/i,
    functions: /\b(operations|ops|supply chain|strategy)\b/i,
  },
]

const SENIOR_PLUS = /\b(director|vp|head|c.?level|chief|founder|ceo|cmo|cro|cfo|cto|coo|cpo)\b/i

function matchesBroadAlias(event: AirtableEvent, user: AirtableUser): boolean {
  if (!SENIOR_PLUS.test(user.seniority || '')) return false
  const audienceText = (event.audience ?? []).join(' | ')
  const userFn = user.function ?? ''
  return BROAD_ALIAS_FLOORS.some(
    (a) => a.audience.test(audienceText) && a.functions.test(userFn),
  )
}

// Function-literal audience terms: "Marketing Leaders", "Sales VPs",
// "Engineering Executives" etc. These literally name a single function
// + a leadership rank, and the LLM keeps under-scoring them as
// "adjacent seniority" (0.6) when the rubric's intent is literal
// function match (1.2 tier — function literal, seniority not). Floor
// fires only at Director+ seniority so an IC at a "Marketing Leaders"
// event still legitimately scores low.
const FUNCTION_LITERAL_FLOORS: Array<{ audience: RegExp; functions: RegExp }> = [
  { audience: /\bmarketing\s+(leader|executive|officer|vp|director|head)/i,                       functions: /\bmarketing\b/i },
  { audience: /\bsales\s+(leader|executive|officer|vp|director|head)/i,                           functions: /\bsales\b/i },
  { audience: /\bengineering\s+(leader|executive|officer|vp|director|head)/i,                     functions: /\b(engineering|platform|infrastructure)\b/i },
  { audience: /\bproduct\s+(leader|executive|officer|vp|director|head)/i,                         functions: /\bproduct\b/i },
  { audience: /\b(operations|ops)\s+(leader|executive|officer|vp|director|head)/i,                functions: /\b(operations|ops)\b/i },
  { audience: /\b(finance|financial)\s+(leader|executive|officer|vp|director|head)/i,             functions: /\b(finance|financial)\b/i },
  { audience: /\b(legal|counsel)\s+(leader|executive|officer|vp|director|head)/i,                 functions: /\b(legal|counsel)\b/i },
  { audience: /\b(people|hr|human\s+resources)\s+(leader|executive|officer|vp|director|head)/i,   functions: /\b(people|hr|human\s+resources)\b/i },
  { audience: /\b(revops|rev\s+ops|revenue\s+operations)\s+(leader|executive|officer|vp|director|head)/i, functions: /\b(revops|rev\s+ops|revenue\s+operations)\b/i },
  { audience: /\b(customer\s+success|cs)\s+(leader|executive|officer|vp|director|head)/i,         functions: /\b(customer\s+success|cs)\b/i },
]

function matchesFunctionLiteral(event: AirtableEvent, user: AirtableUser): boolean {
  if (!SENIOR_PLUS.test(user.seniority || '')) return false
  const audienceText = (event.audience ?? []).join(' | ')
  const userFn = user.function ?? ''
  return FUNCTION_LITERAL_FLOORS.some(
    (a) => a.audience.test(audienceText) && a.functions.test(userFn),
  )
}

// True when at least one of the user's stated topics (other than the
// Women term itself) appears verbatim in the event's name, audience,
// or description. Word-boundary, case-insensitive. Used to gate the
// Women audience floor — opting in to a women-only event isn't enough
// on its own; the user needs another professional topic that lines up
// with the event before we award the literal-match tier. Stops a
// Sales-focused user landing high on a "Women Engineering Leaders"
// event just because they ticked Women.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasNonWomenTopicMatchingEvent(
  event: AirtableEvent,
  user: AirtableUser,
): boolean {
  const eventText = [
    event.name ?? '',
    (event.audience ?? []).join(' '),
    event.description ?? '',
  ].join(' ')
  const topics = (user.interest ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  for (const topic of topics) {
    if (/\bwomen\b|\bwomxn\b|\bfemale\b/i.test(topic)) continue
    if (new RegExp(`\\b${escapeRegex(topic)}\\b`, 'i').test(eventText)) {
      return true
    }
  }
  return false
}

// Post-LLM deterministic floors on the audience leg. Keeps the rubric
// the source of truth for the typical case but stops three recurring
// under-scores cold:
//   - Women audience + Women topic + a second non-Women topic that
//     literally matches the event: explicit two-way opt-in with proof
//     of professional fit lands at the literal-match tier (1.2). The
//     second-topic check stops a token Women opt-in from boosting
//     someone whose professional focus is off (e.g. a Sales user on a
//     Women Engineering Leaders event).
//   - Audience names "[Function] Leaders/Executives/VPs/Directors/Heads"
//     and the user's function literally matches at Director+ seniority:
//     1.2 (literal function tier). The LLM keeps under-scoring these as
//     "adjacent seniority" (0.6) when the audience is in fact directly
//     naming their function.
//   - Senior+ function fits a broad-role alias the event names: 0.8,
//     per the rubric tier that the LLM keeps mis-applying.
function audienceFloor(event: AirtableEvent, user: AirtableUser): number {
  let floor = 0
  if (
    isWomenOnlyAudience(event.audience) &&
    topicsIncludeWomen(user.interest) &&
    hasNonWomenTopicMatchingEvent(event, user)
  ) {
    floor = Math.max(floor, 1.2)
  }
  if (matchesFunctionLiteral(event, user)) {
    floor = Math.max(floor, 1.2)
  }
  if (matchesBroadAlias(event, user)) {
    floor = Math.max(floor, 0.8)
  }
  return floor
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
      reason: 'Skipped: user not within 150 miles of event city',
      skippedReason: 'location_zero',
      inputsHash,
    })
  }

  // Short-circuit 3: women-only audience gate. Deterministic, no LLM
  // call. See shouldExcludeFromWomenOnlyEvent above for the policy.
  if (shouldExcludeFromWomenOnlyEvent(event, user)) {
    return emptyResult({
      location,
      quality,
      reason: 'Skipped: women-only audience, attendee out of scope',
      skippedReason: 'women_only_audience',
      inputsHash,
    })
  }

  // Short-circuit 4: seniority gate. Fires only when the event restricts
  // seniority (fewer than all options checked). All options = no restriction.
  // Users with blank/non-canonical seniority pass through.
  if (
    (event.seniority?.length ?? 0) > 0 &&
    (event.seniority?.length ?? 0) < SENIORITY_OPTIONS.length
  ) {
    const userSeniority = user.seniority?.trim() ?? ''
    if (userSeniority && !event.seniority!.includes(userSeniority)) {
      return emptyResult({
        location,
        quality,
        reason: 'Skipped: seniority not in event filter',
        skippedReason: 'seniority_mismatch',
        inputsHash,
      })
    }
  }

  // Short-circuit 5: employment gate. Fires only when the event restricts
  // employment (fewer than all 4 options). Blank user employment passes through.
  if (
    (event.employment?.length ?? 0) > 0 &&
    (event.employment?.length ?? 0) < EMPLOYMENT_OPTIONS.length
  ) {
    const userEmployment = user.employment?.trim() ?? ''
    if (userEmployment && !event.employment!.includes(userEmployment)) {
      return emptyResult({
        location,
        quality,
        reason: 'Skipped: employment type not in event filter',
        skippedReason: 'employment_mismatch',
        inputsHash,
      })
    }
  }

  // Short-circuit 6: company size gate. Fires only when the event restricts
  // company size (fewer than all 6 revenue options). Blank user size passes through.
  if (
    (event.companySize?.length ?? 0) > 0 &&
    (event.companySize?.length ?? 0) < COMPANY_SIZE_OPTIONS.length
  ) {
    const userCompanySize = user.companySize?.trim() ?? ''
    if (userCompanySize && !event.companySize!.includes(userCompanySize)) {
      return emptyResult({
        location,
        quality,
        reason: 'Skipped: company size not in event filter',
        skippedReason: 'company_size_mismatch',
        inputsHash,
      })
    }
  }

  // Short-circuit 7: empty interest → skip the LLM's preferences leg, but we still need audience.
  // Run one combined LLM call regardless; the prompt instructs it to return preferences=1.0
  // when interest is missing. This keeps the code paths uniform.
  const llm = await callLLM(event, user, fixedSide)

  // Deterministic floors on the audience leg — see audienceFloor() for
  // the policy. The model's read sets the ceiling; the floor stops two
  // recurring underscores (women opt-in, broad-role alias) from
  // killing otherwise-good matches.
  const audience = Math.max(llm.audience, audienceFloor(event, user))
  const score = location * audience * quality * llm.preferences
  return {
    score,
    matchPercent: buildToPercent(score),
    location,
    audience,
    quality,
    preferences: llm.preferences,
    reason: llm.reason,
    skippedReason: null,
    inputsHash,
  }
}
