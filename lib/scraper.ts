export async function scrapeUrl(url: string): Promise<string> {
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
  const extracted = extractTextFromHtml(html)
  console.log(
    `scrapeUrl: ${url} status=${response.status} html=${html.length}b extracted=${extracted.length}b preview=${JSON.stringify(extracted.slice(0, 200))}`,
  )
  return extracted
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
          if (ev.start_at) extracted['Start Date'] = ev.start_at
          if (ev.end_at) extracted['End Date'] = ev.end_at
          if (ev.timezone) extracted['Timezone'] = ev.timezone
          if (location) extracted['Location'] = location
          if (ev.location_type === 'online') extracted['Location'] = 'Virtual'
          // Extract plain text from description_mirror (ProseMirror/TipTap rich text)
          if (lumaData.description_mirror?.content) {
            const plainText = extractRichText(lumaData.description_mirror)
            if (plainText) extracted['Description'] = plainText.substring(0, 500)
          }
          parts.push(`Event Data:\n${Object.entries(extracted).map(([k, v]) => `${k}: ${v}`).join('\n')}`)
        } else {
          // Generic Next.js page — pass first 3000 chars of pageProps
          parts.push(`Page Data: ${JSON.stringify(pageProps).substring(0, 3000)}`)
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
    .replace(/\s+/g, ' ')
    .trim()

  if (bodyText.length > 2000) {
    parts.push(bodyText.substring(0, 2000))
  } else if (bodyText.length > 50) {
    parts.push(bodyText)
  }

  const result = parts.join('\n\n')
  return result.length > 10000 ? result.substring(0, 10000) : result
}
