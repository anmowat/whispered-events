import { NextRequest, NextResponse } from 'next/server'
import { getEventById } from '@/lib/events'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  const event = await getEventById(id)
  if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ event: { name: event.name, link: event.link ?? null } })
}
