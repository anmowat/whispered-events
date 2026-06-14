import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { createTopic, getTopics, reorderTopics } from '@/lib/supabase'

// Admin-only CRUD for the chip-picker topic list.
//   GET    /api/admin/topics            → list all topics (with taxonomy)
//   POST   /api/admin/topics            → { name, taxonomy } create new
//   PATCH  /api/admin/topics            → { orderedIds[] } reorder all
//
// Single-row patches (rename, change taxonomy) and deletes live on
// /api/admin/topics/[id].

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
  let body: { name?: string; taxonomy?: string }
  try {
    body = (await req.json()) as { name?: string; taxonomy?: string }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const name = (body.name ?? '').trim()
  const taxonomy = (body.taxonomy ?? '').trim()
  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  if (!taxonomy) {
    return NextResponse.json({ error: 'taxonomy required' }, { status: 400 })
  }
  const topic = await createTopic(name, taxonomy)
  if (!topic) {
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
