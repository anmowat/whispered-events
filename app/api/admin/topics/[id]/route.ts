import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { deleteTopic, updateTopic } from '@/lib/supabase'

// Single-row patch + delete for /admin/topics inline editing.

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  let body: { name?: string; taxonomy?: string }
  try {
    body = (await req.json()) as { name?: string; taxonomy?: string }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (body.name === undefined && body.taxonomy === undefined) {
    return NextResponse.json({ error: 'name or taxonomy required' }, { status: 400 })
  }
  const topic = await updateTopic(params.id, body)
  if (!topic) {
    return NextResponse.json({ error: 'update failed (duplicate?)' }, { status: 409 })
  }
  return NextResponse.json({ topic })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const ok = await deleteTopic(params.id)
  if (!ok) {
    return NextResponse.json({ error: 'delete failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
