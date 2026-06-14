import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { createTopic, getTopics, reorderTopics } from '@/lib/supabase'

// Admin-only CRUD for the curated interest-topic chips. GET returns
// the full ordered list; POST creates a new topic appended to the
// bottom; PATCH accepts { orderedIds: string[] } and reassigns the
// sort_order column for everything in one shot (used by the up/down
// arrows on /admin/topics).

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const topics = await getTopics()
  return NextResponse.json({ topics })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  let body: { name?: string }
  try {
    body = (await req.json()) as { name?: string }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const name = (body.name ?? '').trim()
  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  const topic = await createTopic(name)
  if (!topic) {
    // Could be the unique-constraint trip (duplicate name) or any other
    // Supabase failure; the helper logs detail and we surface a generic
    // 409 here so the UI can show 'already exists' without leaking guts.
    return NextResponse.json({ error: 'could not create (duplicate?)' }, { status: 409 })
  }
  return NextResponse.json({ topic })
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  let body: { orderedIds?: string[] }
  try {
    body = (await req.json()) as { orderedIds?: string[] }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!Array.isArray(body.orderedIds)) {
    return NextResponse.json({ error: 'orderedIds[] required' }, { status: 400 })
  }
  const ok = await reorderTopics(body.orderedIds)
  if (!ok) {
    return NextResponse.json({ error: 'reorder failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
