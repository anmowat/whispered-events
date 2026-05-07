// Geocoding via Nominatim (OpenStreetMap).
//
// Free, no API key. Hard rate limit: 1 request/sec, requires a real User-Agent.
// We throttle outbound calls and cache results in process memory so repeated
// lookups within a serverless cold-start don't hit the network.

interface LatLng { lat: number; lng: number }

const cache = new Map<string, LatLng | null>()
let lastRequestAt = 0
const MIN_INTERVAL_MS = 1100
const USER_AGENT = 'WhisperedEvents/1.0 (https://www.whisperedevents.com)'

async function throttle(): Promise<void> {
  const now = Date.now()
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - now)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
}

export async function geocodeLocation(text: string): Promise<LatLng | null> {
  if (!text) return null
  const key = text.trim().toLowerCase()
  if (!key) return null
  if (cache.has(key)) return cache.get(key)!

  await throttle()
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(text)}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    })
    if (!res.ok) {
      console.warn(`geocodeLocation: nominatim HTTP ${res.status} for "${text}"`)
      cache.set(key, null)
      return null
    }
    const data = (await res.json()) as Array<{ lat: string; lon: string }>
    if (!data.length) {
      cache.set(key, null)
      return null
    }
    const lat = Number(data[0].lat)
    const lng = Number(data[0].lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      cache.set(key, null)
      return null
    }
    const result = { lat, lng }
    cache.set(key, result)
    return result
  } catch (err) {
    console.warn(`geocodeLocation: nominatim fetch failed for "${text}"`, err)
    return null
  }
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
