import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { getOfferById, updateOffer } from '@/lib/offers'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const item = await getOfferById(params.id)
    if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({ item })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown
      logoUrl?: unknown
      bannerUrl?: unknown
      ctaText?: unknown
      url?: unknown
      status?: unknown
    }
    const update: Parameters<typeof updateOffer>[1] = {}
    if (typeof body.name === 'string') update.name = body.name
    if (typeof body.logoUrl === 'string') update.logoUrl = body.logoUrl
    if (typeof body.bannerUrl === 'string') update.bannerUrl = body.bannerUrl
    if (typeof body.ctaText === 'string') update.ctaText = body.ctaText
    if (typeof body.url === 'string') update.url = body.url
    if (body.status === 'active' || body.status === 'inactive') update.status = body.status
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
    }
    const item = await updateOffer(params.id, update)
    return NextResponse.json({ item })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
