import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import {
  getAnchorEventById,
  updateAnchorEvent,
  setAnchorEventEvents,
  setAnchorEventOffers,
  getAnchorEventEventIds,
  getAnchorEventOfferIds,
} from '@/lib/anchor-events'
import { getEventById } from '@/lib/events'
import { getOfferById } from '@/lib/offers'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const item = await getAnchorEventById(params.id)
    if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const [eventIds, offerIds] = await Promise.all([
      getAnchorEventEventIds(item.id),
      getAnchorEventOfferIds(item.id),
    ])
    // Fetch event + offer details for the admin UI
    const [events, offers] = await Promise.all([
      Promise.all(eventIds.map((id) => getEventById(id))),
      Promise.all(offerIds.map((id) => getOfferById(id))),
    ])
    return NextResponse.json({
      item,
      events: events.filter(Boolean),
      offers: offers.filter(Boolean),
    })
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
      slug?: unknown
      title?: unknown
      anchorName?: unknown
      anchorUrl?: unknown
      anchorIconUrl?: unknown
      description?: unknown
      status?: unknown
      eventIds?: unknown
      offerIds?: unknown
    }

    const update: Parameters<typeof updateAnchorEvent>[1] = {}
    if (typeof body.slug === 'string') update.slug = body.slug.trim().toLowerCase().replace(/\s+/g, '-')
    if (typeof body.title === 'string') update.title = body.title
    if (typeof body.anchorName === 'string') update.anchorName = body.anchorName
    if (typeof body.anchorUrl === 'string') update.anchorUrl = body.anchorUrl
    if (typeof body.anchorIconUrl === 'string') update.anchorIconUrl = body.anchorIconUrl
    if (typeof body.description === 'string') update.description = body.description
    if (body.status === 'draft' || body.status === 'live') update.status = body.status

    const tasks: Promise<unknown>[] = []
    if (Object.keys(update).length > 0) {
      tasks.push(updateAnchorEvent(params.id, update))
    }
    if (Array.isArray(body.eventIds)) {
      const ids = body.eventIds.filter((e): e is string => typeof e === 'string')
      tasks.push(setAnchorEventEvents(params.id, ids))
    }
    if (Array.isArray(body.offerIds)) {
      const ids = body.offerIds.filter((e): e is string => typeof e === 'string')
      tasks.push(setAnchorEventOffers(params.id, ids))
    }
    if (tasks.length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
    }
    await Promise.all(tasks)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
