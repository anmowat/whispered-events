// User enrichment from LinkedIn via AnySite. Calls AnySite for the profile,
// then uses Claude Haiku to classify job function and seniority using the
// nuanced rules defined in classifyProfileFunctionAndSeniority (lib/claude.ts).
// Writes back through updateUserAdmin so both Airtable and Supabase pick up
// the change in a single mirrored write.

import { updateUserAdmin } from './airtable'
import { classifyProfileFunctionAndSeniority } from './claude'

const ANYSITE_USER_ENDPOINT = 'https://api.anysite.io/api/linkedin/user'

interface AnySiteExperience {
  position?: string
  started_on?: string
  ended_on?: string
  duration_in_months?: number
  company?: string
  company_size?: string
}

interface AnySitePerson {
  name?: string
  first_name?: string
  last_name?: string
  headline?: string
  experience?: AnySiteExperience[]
}

function toHandle(value: string): string {
  const s = String(value).trim()
  const m = s.match(/linkedin\.com\/in\/([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]) : s.replace(/\/+$/, '')
}

export interface EnrichmentResult {
  ok: boolean
  name?: string
  function?: string
  seniority?: string
  /** Populated when ok=false, or when ok=true but nothing changed. */
  reason?: string
}

// Strip surrounding quotes + whitespace from an env-var value. Common
// paste-from-terminal artifact (e.g. `"abc123"\n`) silently breaks header
// auth otherwise. Mirrors the `normalize` helper used elsewhere for
// webhook-secret comparisons.
function normalizeSecret(v: string | undefined): string {
  if (!v) return ''
  let s = v.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s
}

// Fingerprint a secret so we can verify the value matches what's expected
// without exposing it in logs. Same shape as the airtable-rematch debug
// log: first 2 + last 2 chars + length.
function fingerprint(v: string): string {
  if (!v) return '<empty>'
  if (v.length <= 4) return `<short len=${v.length}>`
  return `${v.slice(0, 2)}…${v.slice(-2)}(len=${v.length})`
}

export async function enrichUserFromLinkedIn(
  userId: string,
  linkedinUrl: string,
): Promise<EnrichmentResult> {
  if (!linkedinUrl) return { ok: false, reason: 'no linkedin url on record' }
  const apiKey = normalizeSecret(process.env.ANYSITE_API_KEY)
  if (!apiKey) {
    return { ok: false, reason: 'ANYSITE_API_KEY not set' }
  }

  const handle = toHandle(linkedinUrl)

  // Retry on transient overload/rate-limit (529, 503, 502) with backoff.
  // Non-retryable errors (401, 404, 400) fail immediately.
  const RETRYABLE = new Set([429, 502, 503, 529])
  const MAX_ATTEMPTS = 3
  let resp: Response | null = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
    try {
      resp = await fetch(ANYSITE_USER_ENDPOINT, {
        method: 'POST',
        headers: {
          // AnySite uses access-token, NOT Authorization: Bearer.
          'access-token': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user: handle, with_experience: true }),
      })
    } catch (err) {
      if (attempt === MAX_ATTEMPTS - 1) {
        return { ok: false, reason: `AnySite fetch failed: ${err instanceof Error ? err.message : String(err)}` }
      }
      continue
    }
    if (!RETRYABLE.has(resp.status)) break
    if (attempt < MAX_ATTEMPTS - 1) {
      console.warn(`enrichUserFromLinkedIn: AnySite ${resp.status}, retrying (attempt ${attempt + 1})`)
    }
  }
  if (!resp) return { ok: false, reason: 'AnySite fetch failed after retries' }

  // 401 means the access-token header didn't authenticate. Log a fingerprint
  // of the key so admin can compare against the AnySite dashboard value
  // without exposing the secret in plaintext.
  if (resp.status === 401) {
    console.error('enrichUserFromLinkedIn: AnySite 401', {
      handle,
      keyFingerprint: fingerprint(apiKey),
      rawEnvLen: process.env.ANYSITE_API_KEY?.length ?? 0,
    })
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    return { ok: false, reason: `AnySite ${resp.status}: ${body.slice(0, 200)}` }
  }

  const data = (await resp.json().catch(() => null)) as
    | AnySitePerson
    | AnySitePerson[]
    | null
  if (!data) return { ok: false, reason: 'AnySite returned non-JSON body' }
  const person: AnySitePerson = (Array.isArray(data) ? data[0] : data) || {}

  const fullName =
    person.name ||
    [person.first_name, person.last_name].filter(Boolean).join(' ') ||
    ''
  const experiences = Array.isArray(person.experience) ? person.experience : []

  const classification = await classifyProfileFunctionAndSeniority(
    experiences,
    person.headline || '',
  )

  const func = classification.function && classification.function !== 'n/a' ? classification.function : ''
  const seniority = classification.seniority && classification.seniority !== 'n/a' ? classification.seniority : ''

  const updates: Parameters<typeof updateUserAdmin>[1] = {}
  if (fullName) updates.name = fullName
  if (func) updates.function = func
  if (seniority) updates.seniority = seniority

  if (Object.keys(updates).length === 0) {
    return {
      ok: true,
      name: fullName,
      function: func || undefined,
      seniority: seniority || undefined,
      reason: 'profile parsed but no fields to update',
    }
  }

  try {
    await updateUserAdmin(userId, updates)
  } catch (err) {
    return {
      ok: false,
      reason: `updateUserAdmin failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (func && seniority) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://whisperedevents.com'
    fetch(`${baseUrl}/api/process-matches?trigger=user&id=${userId}&noEmail=1`, {
      headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
    }).catch(() => {})
  }

  return {
    ok: true,
    name: fullName,
    function: func || undefined,
    seniority: seniority || undefined,
  }
}
