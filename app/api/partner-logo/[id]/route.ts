import { NextResponse } from 'next/server'
import Airtable from 'airtable'

// Proxies the Airtable attachment for a Partner's Logo so the browser sees a
// stable URL. Airtable's v5 attachment URLs are signed and expire after ~2h;
// caching the signed URL upstream meant logos broke whenever the cache outlived
// the signature. By fetching the bytes on the server and serving them ourselves
// with a long Cache-Control, the Vercel CDN holds the image for 24h+ and we hit
// Airtable at most once per partner per day.

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
    const record = await getBase()('Partners').find(params.id)
    const logo = record.get('Logo') as Array<{ url: string; type?: string }> | undefined
    const url = logo?.[0]?.url
    if (!url) {
      return NextResponse.json({ error: 'no logo' }, { status: 404 })
    }

    const upstream = await fetch(url)
    if (!upstream.ok) {
      console.error(`partner-logo: upstream ${upstream.status} for ${params.id}`)
      return NextResponse.json({ error: 'upstream error' }, { status: 502 })
    }

    const body = await upstream.arrayBuffer()
    const contentType =
      upstream.headers.get('content-type') || logo?.[0]?.type || 'image/png'

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('partner-logo error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
