import { NextResponse } from 'next/server'
import Airtable from 'airtable'
import { createClient } from '@supabase/supabase-js'

// Proxies the event Image attachment so the browser sees a stable URL. The
// modern path: lib/sync.ts uploads each event's image to Supabase Storage at
// sync time and stamps events.image_url with the public bucket URL. This
// handler reads that column and 302-redirects to it, so the bytes never
// round-trip through Vercel.
//
// Legacy fallback: any event whose image_url is still empty (a not-yet-synced
// row, or one where the Storage upload tripped) falls through to the original
// Airtable signed-URL fetch. Mirrors /api/partner-logo/[id].

export const runtime = 'nodejs'

const CACHE_HEADER =
  'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800'

function getBase() {
  if (!process.env.AIRTABLE_API_KEY) throw new Error('AIRTABLE_API_KEY is not set')
  return new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base('appK8AqOvtEgIquRT')
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    // Fast path: image already persisted in Supabase Storage.
    const supabase = getSupabase()
    const { data: row } = await supabase
      .from('events')
      .select('image_url')
      .eq('id', params.id)
      .maybeSingle()
    const storageUrl = (row as { image_url?: string } | null)?.image_url
    if (storageUrl) {
      return new NextResponse(null, {
        status: 302,
        headers: { Location: storageUrl, 'Cache-Control': CACHE_HEADER },
      })
    }

    // Fallback: not-yet-synced event. Pull the signed URL from Airtable and
    // serve the bytes inline, same as the original behavior.
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
        'Cache-Control': CACHE_HEADER,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('event-image error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
