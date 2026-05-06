import citiesData from '../data/us-cities.json'

interface CityRecord {
  city: string
  state: string
  lat: number
  lng: number
  aliases?: string[]
}

const CITIES: CityRecord[] = citiesData as CityRecord[]

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[.,]/g, '').replace(/\s+/g, ' ')
}

function parseLocation(input: string): { city: string; state: string | null }[] {
  // Split on common multi-city separators ("·", ";", "|", ",AND,", " and ")
  const parts = input
    .split(/[·;|]| and /i)
    .map((p) => p.trim())
    .filter(Boolean)

  return parts
    .map((part) => {
      // Match "City, ST" or "City, State"
      const match = part.match(/^([^,]+?)(?:,\s*([A-Za-z .]+))?$/)
      if (!match) return null
      const city = normalize(match[1])
      let state: string | null = null
      if (match[2]) {
        const raw = normalize(match[2])
        if (raw.length === 2) state = raw.toUpperCase()
        else state = STATE_NAME_TO_CODE[raw] ?? null
      }
      return { city, state }
    })
    .filter((p): p is { city: string; state: string | null } => p !== null && p.city.length > 0)
}

export function geocodeLocation(text: string): { lat: number; lng: number } | null {
  if (!text) return null
  const parsed = parseLocation(text)
  for (const { city, state } of parsed) {
    const match = findCity(city, state)
    if (match) return { lat: match.lat, lng: match.lng }
  }
  return null
}

export function geocodeAllLocations(text: string): { lat: number; lng: number }[] {
  if (!text) return []
  const parsed = parseLocation(text)
  const results: { lat: number; lng: number }[] = []
  const seen = new Set<string>()
  for (const { city, state } of parsed) {
    const match = findCity(city, state)
    if (match) {
      const key = `${match.lat.toFixed(3)},${match.lng.toFixed(3)}`
      if (!seen.has(key)) {
        seen.add(key)
        results.push({ lat: match.lat, lng: match.lng })
      }
    }
  }
  return results
}

function findCity(city: string, state: string | null): CityRecord | null {
  // Exact match first (city + state)
  if (state) {
    const exact = CITIES.find(
      (c) => c.state === state && (normalize(c.city) === city || (c.aliases ?? []).some((a) => normalize(a) === city)),
    )
    if (exact) return exact
  }

  // Fall back to city-only match (first hit)
  const cityOnly = CITIES.find(
    (c) => normalize(c.city) === city || (c.aliases ?? []).some((a) => normalize(a) === city),
  )
  return cityOnly ?? null
}

export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.8 // Earth radius in miles
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
