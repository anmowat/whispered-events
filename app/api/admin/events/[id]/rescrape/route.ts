import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { getEventById } from '@/lib/events'
import { updateEvent } from '@/lib/airtable'
import { scrapeUrl } from '@/lib/scraper'
import { parseEventContent } from '@/lib/claude'

export const maxDuration = 30

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const eventId = params.id
  if (!eventId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const event = await getEventById(eventId)
  if (!event) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  if (!event.link) {
    return NextResponse.json({ error: 'event has no link to scrape' }, { status: 400 })
  }

  // Scrape the event URL, merging thin results with any fallback
  let scrapedText = ''
  try {
    const scrape = await scrapeUrl(event.link)
    // JS-rendered SPAs return a near-empty shell via plain fetch.
    // If the scraped content is thin, tell Claude explicitly so it
    // knows the page likely requires JavaScript to render fully.
    scrapedText = scrape.text.length < 300 && scrape.text.length > 0
      ? `Note: this page appears to be JavaScript-rendered (only ${scrape.text.length} chars retrieved). Extract whatever date, location, or other details are visible.\n\n${scrape.text}`
      : scrape.text
  } catch (e) {
    return NextResponse.json(
      { error: `Scrape failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  const parsed = await parseEventContent(scrapedText, event.link)

  // Only update fields that were missing or blank on the existing event
  // and were successfully extracted by the scraper. This prevents
  // overwriting admin edits with re-parsed data.
  const update: Record<string, unknown> = {}
  const updated: string[] = []

  if (!event.date && parsed.date) {
    update.date = parsed.date
    updated.push(`date → ${parsed.date}`)
  }
  if (!event.location && parsed.location) {
    update.location = parsed.location
    updated.push(`location → ${parsed.location}`)
  }
  if (!event.description && parsed.description) {
    update.description = parsed.description
    updated.push('description')
  }
  if ((!event.audience || event.audience.length === 0) && parsed.audience?.length) {
    update.audience = parsed.audience
    updated.push(`audience → ${parsed.audience.join(', ')}`)
  }
  if (!event.organizer && parsed.organizer) {
    update.organizer = parsed.organizer
    updated.push(`organizer → ${parsed.organizer}`)
  }
  if (!event.startTime && parsed.startTime) {
    update.startTime = parsed.startTime
    updated.push(`startTime → ${parsed.startTime}`)
  }
  if (!event.endTime && parsed.endTime) {
    update.endTime = parsed.endTime
    updated.push(`endTime → ${parsed.endTime}`)
  }
  // imageUrl is intentionally excluded — images are managed via the
  // dedicated upload button; we don't want a rescrape to overwrite them.

  if (Object.keys(update).length > 0) {
    await updateEvent(eventId, update as Parameters<typeof updateEvent>[1])
  }

  return NextResponse.json({ ok: true, updated })
}
