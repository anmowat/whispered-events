import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin-auth'

//   GET    /api/admin/love              → list all non-deleted entries
//   POST   /api/admin/love              → { author, role?, linkedinUrl? } create
//   PATCH  /api/admin/love              → { orderedIds[] } reorder all

function getClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = getClient()
  const { data, error } = await supabase
    .from('love_entries')
    .select('*')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    console.error('GET /api/admin/love error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ entries: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  let body: { author?: string; role?: string; linkedinUrl?: string }
  try {
    body = (await req.json()) as { author?: string; role?: string; linkedinUrl?: string }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const author = (body.author ?? '').trim()
  if (!author) {
    return NextResponse.json({ error: 'author required' }, { status: 400 })
  }
  const supabase = getClient()
  // sort_order = max existing sort_order + 1
  const { data: maxData } = await supabase
    .from('love_entries')
    .select('sort_order')
    .is('deleted_at', null)
    .order('sort_order', { ascending: false })
    .limit(1)
  const maxOrder = ((maxData?.[0] as { sort_order?: number } | undefined)?.sort_order ?? 0)
  const { data, error } = await supabase
    .from('love_entries')
    .insert({
      author,
      role: (body.role ?? '').trim(),
      linkedin_url: (body.linkedinUrl ?? '').trim(),
      sort_order: maxOrder + 1,
    })
    .select()
    .single()
  if (error) {
    console.error('POST /api/admin/love error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ entry: data })
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
  const supabase = getClient()
  const updates = body.orderedIds.map((id, i) =>
    supabase.from('love_entries').update({ sort_order: i + 1 }).eq('id', id),
  )
  const results = await Promise.all(updates)
  const firstErr = results.find((r) => r.error)
  if (firstErr?.error) {
    console.error('PATCH /api/admin/love reorder error:', firstErr.error)
    return NextResponse.json({ error: firstErr.error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
