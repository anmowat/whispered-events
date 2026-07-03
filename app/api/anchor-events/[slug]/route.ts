import { NextRequest, NextResponse } from 'next/server'
import { getAnchorEventBySlug, getAnchorEventEvents, getAnchorEventOffers } from '@/lib/anchor-events'

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const anchorEvent = await getAnchorEventBySlug(params.slug)
    if (!anchorEvent || anchorEvent.status !== 'live') {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    const [events, offers] = await Promise.all([
      getAnchorEventEvents(anchorEvent.id),
      getAnchorEventOffers(anchorEvent.id),
    ])
    return NextResponse.json({
      anchorEvent,
      events: events.map((e) => ({
        id: e.id,
        name: e.name,
        date: e.date,
        location: e.location,
        description: e.description,
        link: e.link,
        type: e.type,
      })),
      offers,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
