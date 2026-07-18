export interface ScrapeResult {
  // Plain-text excerpt fed to the LLM parser.
  text: string
  // og:image (or fallback) resolved to an absolute URL. Stored as the
  // event's Image attachment on Airtable so featured-event cards can
  // render the source page's hero artwork without a second fetch.
  imageUrl?: string
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }

  const html = await response.text()
  return {
    text: extractTextFromHtml(html),
    imageUrl: extractImageUrl(html, url),
  }
}

// Pulls a single hero image URL from the page in priority order:
//   og:image → twitter:image → JSON-LD Event.image.
// Resolved to an absolute URL against the source page so relative
// paths (rare but seen on some hand-rolled landing pages) work too.
function extractImageUrl(html: string, baseUrl: string): string | undefined {
  // Both attribute orderings — content-first and property-first — show
  // up in the wild; check each.
  const patterns: RegExp[] = [
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
  ]
  for (const p of patterns) {
    const m = html.match(p)
    if (m?.[1]) {
      const resolved = resolveUrl(m[1].trim(), baseUrl)
      if (resolved) return resolved
    }
  }
  // JSON-LD fallback — Event.image may be a string or an array.
  const jsonLdMatches = Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
  for (const m of jsonLdMatches) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = JSON.parse(m[1].trim())
      const candidates: unknown[] = Array.isArray(data) ? data : [data]
      for (const node of candidates) {
        const img = (node as { image?: unknown })?.image
        if (typeof img === 'string') {
          const resolved = resolveUrl(img, baseUrl)
          if (resolved) return resolved
        } else if (Array.isArray(img) && typeof img[0] === 'string') {
          const resolved = resolveUrl(img[0], baseUrl)
          if (resolved) return resolved
        }
      }
    } catch {
      // skip non-JSON
    }
  }
  return undefined
}

function resolveUrl(maybeRelative: string, baseUrl: string): string | undefined {
  try {
    return new URL(maybeRelative, baseUrl).toString()
  } catch {
    return undefined
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractRichText(node: any): string {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (node.type === 'hard_break') return '\n'
  if (Array.isArray(node.content)) {
    return node.content.map(extractRichText).join('')
  }
  return ''
}

function extractTextFromHtml(html: string): string {
  const parts: string[] = []

  // 1. Extract JSON-LD structured data (best source for event sites like lu.ma, Eventbrite)
  const jsonLdMatches = Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(match[1].trim())
      if (data['@type'] === 'Event' || data.name) {
        parts.push(`JSON-LD Event Data: ${JSON.stringify(data)}`)
      }
    } catch {
      // not valid JSON, skip
    }
  }

  // 1b. Extract Next.js __NEXT_DATA__ (lu.ma and other Next.js SPAs embed SSR data here)
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i)
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1].trim())
      const pageProps = nextData?.props?.pageProps
      if (pageProps) {
        // lu.ma structure: pageProps.initialData.data.event + description_mirror
        const lumaData = pageProps?.initialData?.data
        if (lumaData?.event) {
          const ev = lumaData.event
          const geo = ev.geo_address_info
          const location = geo?.city_state || geo?.city || (ev.location_type === 'online' ? 'Virtual' : '')
          const extracted: Record<string, string> = {}
          if (ev.name) extracted['Event Name'] = ev.name
          if (ev.start_at) {
            extracted['Start Date/Time (ISO)'] = ev.start_at
            // Also derive a human-readable local time in the event's timezone
            try {
              const tz = ev.timezone || 'UTC'
              const startLocal = new Date(ev.start_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })
              extracted['Start Time'] = startLocal
            } catch { /* ignore */ }
          }
          if (ev.end_at) {
            extracted['End Date/Time (ISO)'] = ev.end_at
            try {
              const tz = ev.timezone || 'UTC'
              const endLocal = new Date(ev.end_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })
              extracted['End Time'] = endLocal
            } catch { /* ignore */ }
          }
          if (ev.timezone) extracted['Timezone'] = ev.timezone
          if (location) extracted['Location'] = location
          if (ev.location_type === 'online') extracted['Location'] = 'Virtual'
          // Primary organizer: calendar/series name (e.g. "Atlantis Capital Events")
          const calendarName = lumaData.calendar?.name || ev.calendar?.name
          if (calendarName) extracted['Organizer'] = calendarName
          // Fallback: individual hosts from the hosts array
          if (!extracted['Organizer']) {
            const hosts: Array<{ name?: string; username?: string }> = lumaData.hosts ?? ev.hosts ?? []
            if (hosts.length > 0) {
              const hostNames = hosts.map((h) => h.name || h.username).filter(Boolean)
              if (hostNames.length > 0) extracted['Organizer'] = hostNames.join(', ')
            }
          }
          // Final fallback: single "host" field
          if (!extracted['Organizer'] && ev.host?.name) extracted['Organizer'] = ev.host.name
          // Extract plain text from description_mirror (ProseMirror/TipTap rich text)
          if (lumaData.description_mirror?.content) {
            const plainText = extractRichText(lumaData.description_mirror)
            if (plainText) extracted['Description'] = plainText.substring(0, 500)
          }
          parts.push(`Event Data:\n${Object.entries(extracted).map(([k, v]) => `${k}: ${v}`).join('\n')}`)
        } else {
          // Generic Next.js SPA (not lu.ma) — stringify pageProps and look
          // for date-like strings before truncating so the LLM sees them.
          const raw = JSON.stringify(pageProps)
          // Pull out any ISO dates or month-day phrases embedded in the data.
          const dateHints = Array.from(
            raw.matchAll(/\b(\d{4}-\d{2}-\d{2}|\w+ \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*[AP]M)?)\b/g)
          ).map(m => m[0]).slice(0, 20)
          if (dateHints.length) parts.push(`Extracted date hints: ${dateHints.join('; ')}`)
          parts.push(`Page Data: ${raw.substring(0, 3000)}`)
        }
      }
    } catch {
      // not valid JSON, skip
    }
  }

  // 2. Extract meta tags (og:title, og:description, title, description)
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleMatch) parts.push(`Title: ${titleMatch[1].trim()}`)

  const metaTags = [
    { pattern: /property=["']og:title["'][^>]*content=["']([^"']+)["']/i, label: 'OG Title' },
    { pattern: /property=["']og:description["'][^>]*content=["']([^"']+)["']/i, label: 'OG Description' },
    { pattern: /name=["']description["'][^>]*content=["']([^"']+)["']/i, label: 'Description' },
    { pattern: /name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i, label: 'Twitter Description' },
    { pattern: /name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i, label: 'Twitter Title' },
  ]
  for (const { pattern, label } of metaTags) {
    const m = html.match(pattern)
    if (m) parts.push(`${label}: ${m[1].trim()}`)
  }

  // 3. Extract visible body text (strip scripts, styles, nav, footer)
  const bodyText = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2013;/g, '–')
    .replace(/&#x2014;/g, '—')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim()

  if (bodyText.length > 8000) {
    parts.push(bodyText.substring(0, 8000))
  } else if (bodyText.length > 50) {
    parts.push(bodyText)
  }

  const result = parts.join('\n\n')
  return result.length > 12000 ? result.substring(0, 12000) : result
}
