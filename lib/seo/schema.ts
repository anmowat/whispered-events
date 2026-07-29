// Schema.org JSON-LD builders for public, crawlable pages.
//
// These run on the server so the markup lands in the initial HTML. That matters
// more than it sounds: AI answer engines (Perplexity, ChatGPT's fetcher) largely
// do not execute JavaScript, so structured data injected after hydration is
// invisible to exactly the crawlers we care about.

export const SITE_URL = 'https://www.whisperedevents.com'

/** Minimal shape needed to mark up an event. Structurally satisfied by AirtableEvent. */
export interface SchemaEvent {
  id: string
  name: string
  date: string
  location: string
  description?: string
  link?: string
  organizer?: string
  startTime?: string | null
  endTime?: string | null
}

/**
 * "10:00 AM" | "22:30" -> "22:30:00". Returns null for anything we can't parse,
 * so a bad value drops the time rather than producing an invalid ISO 8601
 * startDate (schema.org validators reject `2026-09-15T10:00 AM`).
 */
export function toIsoTime(t: string | null | undefined): string | null {
  if (!t) return null
  const m12 = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (m12) {
    let h = parseInt(m12[1], 10)
    const min = parseInt(m12[2], 10)
    if (m12[3].toUpperCase() === 'AM' && h === 12) h = 0
    if (m12[3].toUpperCase() === 'PM' && h !== 12) h += 12
    if (h > 23 || min > 59) return null
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`
  }
  const m24 = t.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const h = parseInt(m24[1], 10)
    const min = parseInt(m24[2], 10)
    if (h > 23 || min > 59) return null
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`
  }
  return null
}

/** `2026-09-15` + optional time -> ISO 8601 local datetime, or the bare date. */
export function toIsoDateTime(date: string, time?: string | null): string | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  const iso = toIsoTime(time)
  return iso ? `${date}T${iso}` : date
}

const US_STATE = /^[A-Z]{2}$/

/**
 * Free-text location -> PostalAddress. We only claim a country when the string
 * parses as a US "City, ST" pair; otherwise the whole string becomes the
 * locality rather than inventing structure that isn't there.
 */
export function toPostalAddress(location: string): Record<string, string> | null {
  const raw = location.trim()
  if (!raw) return null
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2 && US_STATE.test(parts[parts.length - 1])) {
    return {
      '@type': 'PostalAddress',
      addressLocality: parts[parts.length - 2],
      addressRegion: parts[parts.length - 1],
      addressCountry: 'US',
    }
  }
  return { '@type': 'PostalAddress', addressLocality: raw }
}

/**
 * One schema.org Event. Returns null when the event can't be marked up validly —
 * `name`, `startDate` and `location` are all required by Google, and partial
 * Event markup is treated worse than none at all.
 */
export function buildEventNode(ev: SchemaEvent): Record<string, unknown> | null {
  const startDate = toIsoDateTime(ev.date, ev.startTime)
  const address = toPostalAddress(ev.location ?? '')
  if (!ev.name || !startDate || !address) return null

  const node: Record<string, unknown> = {
    '@type': 'Event',
    name: ev.name,
    startDate,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: ev.location,
      address,
    },
  }
  const endDate = toIsoDateTime(ev.date, ev.endTime)
  // Only emit endDate when it's a real time; a bare date equal to startDate adds nothing.
  if (endDate && endDate !== startDate) node.endDate = endDate
  if (ev.description) node.description = ev.description
  if (ev.link) node.url = ev.link
  if (ev.organizer) node.organizer = { '@type': 'Organization', name: ev.organizer }
  return node
}

export interface BreadcrumbCrumb {
  name: string
  url: string
}

export function buildBreadcrumbNode(crumbs: BreadcrumbCrumb[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  }
}

export interface FaqItem {
  question: string
  answer: string
}

/**
 * FAQPage. Note Google restricted FAQ *rich results* to government/health sites
 * in 2023, so this won't produce a SERP accordion — the value is that answer
 * engines parse it directly. Every Q&A passed here must also be visible on the
 * page; markup-only FAQs are a policy violation.
 */
export function buildFaqNode(faqs: FaqItem[], pageUrl: string): Record<string, unknown> {
  return {
    '@type': 'FAQPage',
    '@id': `${pageUrl}#faq`,
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  }
}

export interface AnchorGraphInput {
  title: string
  description: string
  slug: string
  events: SchemaEvent[]
}

/** The full @graph for an anchor-event page (e.g. /dreamforce). */
export function buildAnchorEventGraph(input: AnchorGraphInput): Record<string, unknown> {
  const url = `${SITE_URL}/${input.slug}`
  const eventNodes = input.events
    .map(buildEventNode)
    .filter((n): n is Record<string, unknown> => n !== null)

  const graph: Record<string, unknown>[] = [
    {
      '@type': 'CollectionPage',
      '@id': url,
      url,
      name: input.title,
      description: input.description || undefined,
      isPartOf: { '@id': `${SITE_URL}/#website` },
    },
    buildBreadcrumbNode([
      { name: 'Whispered Events', url: SITE_URL },
      { name: input.title, url },
    ]),
  ]

  if (eventNodes.length > 0) {
    graph.push({
      '@type': 'ItemList',
      name: input.title,
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      numberOfItems: eventNodes.length,
      itemListElement: eventNodes.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item,
      })),
    })
  }

  return { '@context': 'https://schema.org', '@graph': graph }
}
