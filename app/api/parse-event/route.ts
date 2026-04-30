import { NextRequest, NextResponse } from 'next/server'
import { scrapeUrl } from '@/lib/scraper'
import { parseEventContent } from '@/lib/claude'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { url, text } = body as { url?: string; text?: string }

    if (!url && !text) {
      return NextResponse.json(
        { error: 'Provide a url or text' },
        { status: 400 }
      )
    }

    let content = text || ''
    let sourceUrl = url

    if (url) {
      try {
        content = await scrapeUrl(url)
      } catch {
        // Fall back to just the URL itself as context
        content = `Event URL: ${url}`
      }
    }

    const parsed = await parseEventContent(content, sourceUrl)
    return NextResponse.json({ event: parsed })
  } catch (err) {
    console.error('parse-event error:', err)
    return NextResponse.json(
      { error: 'Failed to parse event' },
      { status: 500 }
    )
  }
}
