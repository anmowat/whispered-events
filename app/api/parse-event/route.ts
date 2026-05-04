import { NextRequest, NextResponse } from 'next/server'
import { scrapeUrl } from '@/lib/scraper'
import { parseEventContent } from '@/lib/claude'

export const maxDuration = 30

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
        console.log('scrape ok, content length:', content.length)
        console.log('scrape preview:', content.substring(0, 300))
      } catch (scrapeErr) {
        console.error('scrape failed:', scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr))
        content = `Event URL: ${url}`
      }
    }

    const parsed = await parseEventContent(content, sourceUrl)
    console.log('parsed result:', JSON.stringify(parsed))
    return NextResponse.json({ event: parsed })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('parse-event error:', message)
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
