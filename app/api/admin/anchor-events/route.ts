import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { listAnchorEvents, createAnchorEvent } from '@/lib/anchor-events'

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const items = await listAnchorEvents()
    return NextResponse.json({ items })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const body = (await req.json()) as {
      slug?: unknown
      title?: unknown
      anchorName?: unknown
      anchorUrl?: unknown
      anchorIconUrl?: unknown
      description?: unknown
    }
    if (typeof body.slug !== 'string' || !body.slug.trim()) {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 })
    }
    const item = await createAnchorEvent({
      slug: body.slug.trim().toLowerCase().replace(/\s+/g, '-'),
      title: typeof body.title === 'string' ? body.title : '',
      anchorName: typeof body.anchorName === 'string' ? body.anchorName : '',
      anchorUrl: typeof body.anchorUrl === 'string' ? body.anchorUrl : '',
      anchorIconUrl: typeof body.anchorIconUrl === 'string' ? body.anchorIconUrl : '',
      description: typeof body.description === 'string' ? body.description : '',
      status: 'draft',
    })
    return NextResponse.json({ item })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
