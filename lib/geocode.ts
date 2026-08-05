// Geocoding via Nominatim (OpenStreetMap).
//
// Free, no API key. Hard rate limit: 1 request/sec, requires a real User-Agent.
// We throttle outbound calls and cache results in process memory so repeated
// lookups within a serverless cold-start don't hit the network.

interface LatLng { lat: number; lng: number }

// Canonical "this user could realistically attend" radius. Lives here
// (not in lib/matching.ts) so client components — welcome page,
// dashboard signup hint, anything that needs the value — can import
// it without dragging server-only deps (Anthropic SDK, crypto) into
// the browser bundle.
export const NEARBY_RADIUS_MILES = 100

const cache = new Map<string, LatLng | null>()
let lastRequestAt = 0
const MIN_INTERVAL_MS = 1100
const USER_AGENT = 'WhisperedEvents/1.0 (https://www.whisperedevents.com)'

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'Washington DC',
}

// "Mason, NH" → "Mason, New Hampshire" so Nominatim resolves small towns reliably
function expandStateAbbr(text: string): string {
  return text.replace(/,\s*([A-Z]{2})\s*$/, (_, abbr: string) => {
    const full = US_STATES[abbr]
    return full ? `, ${full}` : `, ${abbr}`
  })
}

async function throttle(): Promise<void> {
  const now = Date.now()
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - now)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
}

function toLatLng(lat: unknown, lng: unknown): LatLng | null {
  const a = Number(lat)
  const b = Number(lng)
  return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b } : null
}

/**
 * A provider returns coordinates, or null when it genuinely has no match.
 * Anything else — HTTP error, network failure, unparseable body — throws, so
 * the caller can fall through to the next provider instead of mistaking an
 * outage for "this place doesn't exist".
 */
interface Provider {
  name: string
  lookup(query: string): Promise<LatLng | null>
}

const nominatim: Provider = {
  name: 'nominatim',
  async lookup(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    })
    if (!res.ok) throw new Error(`nominatim HTTP ${res.status}`)
    const data = (await res.json()) as Array<{ lat: string; lon: string }>
    return data.length ? toLatLng(data[0].lat, data[0].lon) : null
  },
}

// Same OpenStreetMap data as Nominatim, but without the usage policy that gets
// shared cloud egress IPs blocked — which is what was silently failing every
// lookup from Vercel while the identical query succeeded elsewhere.
const photon: Provider = {
  name: 'photon',
  async lookup(query) {
    const url = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`photon HTTP ${res.status}`)
    const data = (await res.json()) as {
      features?: Array<{ geometry?: { coordinates?: [number, number] } }>
    }
    const coords = data.features?.[0]?.geometry?.coordinates
    // GeoJSON is [lng, lat] — the opposite order to everything else here.
    return coords ? toLatLng(coords[1], coords[0]) : null
  },
}

const PROVIDERS: Provider[] = [nominatim, photon]

// When a provider is being blocked outright, every lookup would otherwise pay
// its failure plus the throttle before falling through. Skip it for a while
// after repeated failures, then let it back in.
const FAILURE_THRESHOLD = 3
const COOLDOWN_MS = 5 * 60 * 1000
const providerHealth = new Map<string, { failures: number; skipUntil: number }>()

function isSkipped(name: string): boolean {
  const h = providerHealth.get(name)
  return !!h && h.skipUntil > Date.now()
}

function recordFailure(name: string): void {
  const h = providerHealth.get(name) ?? { failures: 0, skipUntil: 0 }
  h.failures += 1
  if (h.failures >= FAILURE_THRESHOLD) {
    h.skipUntil = Date.now() + COOLDOWN_MS
    h.failures = 0
    console.warn(`geocodeLocation: ${name} failing repeatedly — skipping it for ${COOLDOWN_MS / 60000}m`)
  }
  providerHealth.set(name, h)
}

function recordSuccess(name: string): void {
  providerHealth.set(name, { failures: 0, skipUntil: 0 })
}

export async function geocodeLocation(text: string): Promise<LatLng | null> {
  if (!text) return null
  const key = text.trim().toLowerCase()
  if (!key) return null
  if (cache.has(key)) return cache.get(key)!

  const query = expandStateAbbr(text.trim())
  let allProvidersFailed = true

  for (const provider of PROVIDERS) {
    if (isSkipped(provider.name)) continue
    await throttle()
    try {
      const result = await provider.lookup(query)
      recordSuccess(provider.name)
      // A definitive no-match still lets the next provider try — the indexes
      // differ — but it means the lookup itself worked.
      allProvidersFailed = false
      if (result) {
        cache.set(key, result)
        return result
      }
    } catch (err) {
      recordFailure(provider.name)
      console.warn(
        `geocodeLocation: ${provider.name} failed for "${text}":`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  // Only memoize a miss when at least one provider answered. Caching an
  // outage would pin the failure for the life of the process and make every
  // retry in that window fail too.
  if (!allProvidersFailed) cache.set(key, null)
  return null
}

export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function withinMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  miles: number,
): boolean {
  return haversineMiles(a, b) <= miles
}
