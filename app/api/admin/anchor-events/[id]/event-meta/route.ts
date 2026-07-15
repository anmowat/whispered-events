import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { updateAnchorEventEventMeta } from '@/lib/anchor-events'

// PATCH { eventId, startTime?, featured? }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as {
    eventId?: string
    startTime?: string | null
    featured?: boolean
  }
  if (!body.eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 })
  try {
    const fields: Parameters<typeof updateAnchorEventEventMeta>[2] = {}
    if ('startTime' in body) fields.startTime = body.startTime ?? null
    if ('featured' in body) fields.featured = body.featured
    await updateAnchorEventEventMeta(params.id, body.eventId, fields)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
