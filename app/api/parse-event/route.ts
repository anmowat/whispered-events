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
    let imageUrl: string | undefined

    if (url) {
      try {
        const scrape = await scrapeUrl(url)
        content = scrape.text
        imageUrl = scrape.imageUrl
        console.log('scrape ok, content length:', content.length, 'image:', imageUrl ?? '(none)')
        console.log('scrape preview:', content.substring(0, 300))
      } catch (scrapeErr) {
        console.error('scrape failed:', scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr))
        content = `Event URL: ${url}`
      }
    }

    const parsed = await parseEventContent(content, sourceUrl)
    if (imageUrl) parsed.image = imageUrl
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
