import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { listOffers, createOffer } from '@/lib/offers'

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const items = await listOffers()
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
      name?: unknown
      logoUrl?: unknown
      bannerUrl?: unknown
      ctaText?: unknown
      url?: unknown
    }
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const item = await createOffer({
      name: body.name.trim(),
      logoUrl: typeof body.logoUrl === 'string' ? body.logoUrl : '',
      bannerUrl: typeof body.bannerUrl === 'string' ? body.bannerUrl : '',
      ctaText: typeof body.ctaText === 'string' ? body.ctaText : '',
      url: typeof body.url === 'string' ? body.url : '',
      status: 'active',
    })
    return NextResponse.json({ item })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
