import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import {
  getAnchorEventsForEvent,
  listAnchorEvents,
  addEventToAnchorEvent,
  removeEventFromAnchorEvent,
} from '@/lib/anchor-events'

// GET: returns { linked: AnchorEvent[], all: AnchorEvent[] }
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const [linked, all] = await Promise.all([
      getAnchorEventsForEvent(params.id),
      listAnchorEvents(),
    ])
    return NextResponse.json({ linked, all })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// POST { anchorEventId } — add this event to that anchor event
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { anchorEventId } = (await req.json().catch(() => ({}))) as { anchorEventId?: string }
  if (!anchorEventId) return NextResponse.json({ error: 'anchorEventId required' }, { status: 400 })
  try {
    await addEventToAnchorEvent(anchorEventId, params.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// DELETE { anchorEventId } — remove this event from that anchor event
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { anchorEventId } = (await req.json().catch(() => ({}))) as { anchorEventId?: string }
  if (!anchorEventId) return NextResponse.json({ error: 'anchorEventId required' }, { status: 400 })
  try {
    await removeEventFromAnchorEvent(anchorEventId, params.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
