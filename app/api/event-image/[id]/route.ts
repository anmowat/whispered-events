import { NextResponse } from 'next/server'
import Airtable from 'airtable'

// Proxies the Airtable Image attachment for an Event so the browser sees a
// stable URL. Airtable's v5 attachment URLs are signed and expire after ~2h;
// the homepage caches /api/featured-events for 24h, so any signed URL inside
// that cached JSON breaks long before the cache itself expires. By fetching
// the bytes on the server and serving them ourselves with a long
// Cache-Control, the Vercel CDN holds the image for 24h+ and we hit Airtable
// at most once per event per day. Mirrors /api/partner-logo/[id].

export const runtime = 'nodejs'

function getBase() {
  if (!process.env.AIRTABLE_API_KEY) throw new Error('AIRTABLE_API_KEY is not set')
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base('appK8AqOvtEgIquRT')
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    // Same table as getFeaturedEvents() reads from.
    const record = await getBase()('tbltqCrPbZbETbQRl').find(params.id)
    const image = record.get('Image') as
      | Array<{
          url: string
          type?: string
          thumbnails?: { large?: { url?: string }; small?: { url?: string } }
        }>
      | undefined
    // Prefer Airtable's resized large thumbnail (smaller payload, JPEG-encoded
    // by Airtable regardless of source format) and fall back to the original
    // upload — which may be AVIF / PNG / JPEG depending on the source page.
    const url = image?.[0]?.thumbnails?.large?.url || image?.[0]?.url
    if (!url) {
      return NextResponse.json({ error: 'no image' }, { status: 404 })
    }

    const upstream = await fetch(url)
    if (!upstream.ok) {
      console.error(`event-image: upstream ${upstream.status} for ${params.id}`)
      return NextResponse.json({ error: 'upstream error' }, { status: 502 })
    }

    const body = await upstream.arrayBuffer()
    const contentType =
      upstream.headers.get('content-type') || image?.[0]?.type || 'image/jpeg'

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('event-image error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
