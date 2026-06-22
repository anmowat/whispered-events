// User enrichment from LinkedIn via AnySite. Port of the Airtable automation
// that used to run on new-user creation. Calls AnySite for the profile, then
// keyword-matches job titles to derive a Function tag (one or two labels)
// and a Seniority bucket. Writes back through updateUserAdmin so both
// Airtable and Supabase pick up the change in a single mirrored write.
//
// Function field is treated as text (comma-joined). Seniority is single-select
// against the existing Airtable options. Adjust the rule lists below to tune
// matches — order matters (specific buckets above broad ones so e.g.
// "sales operations" wins RevOps before falling through to Sales).

import { updateUserAdmin } from './airtable'

const ANYSITE_USER_ENDPOINT = 'https://api.anysite.io/api/linkedin/user'

interface AnySiteExperience {
  position?: string
}

interface AnySitePerson {
  name?: string
  first_name?: string
  last_name?: string
  headline?: string
  experience?: AnySiteExperience[]
}

const FUNCTION_RULES: Array<[string, string[]]> = [
  // Specific operations / niche roles first.
  ['RevOps', ['revenue operations', 'revops', 'rev ops', 'sales operations', 'sales ops', 'marketing operations', 'marketing ops', 'gtm operations', 'go-to-market operations', 'deal desk']],
  ['GTM Engineering', ['gtm engineer', 'gtm engineering', 'go-to-market engineer', 'growth engineer', 'marketing engineer']],
  ['Private Equity', ['private equity', ' pe ', 'buyout']],
  ['Venture Capital', ['venture capital', ' vc ', 'venture partner', 'general partner', 'managing partner', 'venture investor']],
  ['Partnerships', ['partnerships', 'alliances', 'channel', 'partner manager', 'partner marketing', 'ecosystem']],
  ['Customer Success', ['customer success', 'post-sales', 'post sales', 'account management', 'account manager', 'csm', 'renewals', 'implementation', 'customer experience']],
  ['Product Management', ['product management', 'product manager', 'head of product', ' pm ', 'group product', 'chief product', 'cpo']],
  // Broader GTM buckets.
  ['Marketing', ['marketing', 'demand gen', 'demand generation', 'growth', 'brand', 'cmo', 'communications', 'content', 'seo']],
  ['Sales', ['sales', 'account executive', 'account exec', ' ae ', ' sdr', ' bdr', 'business development', 'cro', 'chief revenue', 'quota']],
  ['GTM', ['go-to-market', 'gtm']],
  // Technical / other.
  ['Security', ['security', 'infosec', 'ciso', 'cybersecurity', 'appsec']],
  ['IT', ['information technology', 'it director', 'it manager', 'it operations', 'head of it', 'help desk', 'helpdesk', 'sysadmin', 'system administrator', 'cio']],
  ['Engineering', ['engineer', 'engineering', 'developer', 'software', 'cto', 'chief technology', 'architect', 'devops']],
]

const SENIORITY_RULES: Array<[string, string[]]> = [
  ['C-Level', ['chief', 'ceo', 'cro', 'cmo', 'coo', 'cfo', 'founder', 'co-founder', 'owner', 'president']],
  ['VP', ['vp', 'vice president', 'svp', 'evp']],
  ['Director', ['director', 'head of']],
  ['Manager', ['manager']],
  ['Lead', ['lead', 'team lead']],
  ['Junior', ['junior', 'associate', 'intern', 'entry level', 'entry-level', 'jr ']],
]

function toHandle(value: string): string {
  const s = String(value).trim()
  const m = s.match(/linkedin\.com\/in\/([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]) : s.replace(/\/+$/, '')
}

function matchAll(rules: Array<[string, string[]]>, text: string): string[] {
  const out: string[] = []
  for (const [label, keywords] of rules) {
    if (keywords.some((k) => text.includes(k))) out.push(label)
  }
  return out
}

export interface EnrichmentResult {
  ok: boolean
  name?: string
  function?: string[]
  seniority?: string
  functionFrom?: string
  seniorityFrom?: string
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
  let resp: Response
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
    return { ok: false, reason: `AnySite fetch failed: ${err instanceof Error ? err.message : String(err)}` }
  }

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
  const currentTitle = (experiences[0] && experiences[0].position) || person.headline || ''

  // [0] = current role + headline (best signal), [1..] = each earlier role
  // newest-first so the walk-back falls back gracefully.
  const roleTexts: string[] = [` ${currentTitle} ${person.headline || ''} `.toLowerCase()]
  for (let i = 1; i < experiences.length; i++) {
    roleTexts.push(` ${experiences[i].position || ''} `.toLowerCase())
  }

  function roleLabel(i: number): string {
    if (i === 0) return 'current role/headline'
    return `role #${i + 1}: ${experiences[i]?.position || '?'}`
  }

  // First role with any match wins. Keep up to 2 function labels (the
  // "VP Sales & Marketing" case); take 1 seniority.
  let funcs: string[] = []
  let funcFrom = ''
  for (let i = 0; i < roleTexts.length; i++) {
    const m = matchAll(FUNCTION_RULES, roleTexts[i])
    if (m.length) {
      funcs = m.slice(0, 2)
      funcFrom = roleLabel(i)
      break
    }
  }
  let seniority = ''
  let seniorityFrom = ''
  for (let i = 0; i < roleTexts.length; i++) {
    const m = matchAll(SENIORITY_RULES, roleTexts[i])
    if (m.length) {
      seniority = m[0]
      seniorityFrom = roleLabel(i)
      break
    }
  }

  const updates: Parameters<typeof updateUserAdmin>[1] = {}
  if (fullName) updates.name = fullName
  // Function is a text field in Airtable today (lib/sync.ts treats it as
  // String). If you ever flip it to multiselect, replace this join with
  // the array shape and update updateUserAdmin to forward it.
  if (funcs.length) updates.function = funcs.join(', ')
  if (seniority) updates.seniority = seniority

  if (Object.keys(updates).length === 0) {
    return {
      ok: true,
      name: fullName,
      function: funcs,
      seniority,
      functionFrom: funcFrom,
      seniorityFrom: seniorityFrom,
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

  return {
    ok: true,
    name: fullName,
    function: funcs,
    seniority,
    functionFrom: funcFrom,
    seniorityFrom: seniorityFrom,
  }
}
