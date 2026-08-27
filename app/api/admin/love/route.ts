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
  // New entries go to the top: one below the current lowest sort_order, since
  // both the admin list and the public page sort ascending.
  //
  // Taking min - 1 rather than shifting every other row keeps this a single
  // insert. Values drift negative as entries are added, which is harmless —
  // ordering is relative, and the reorder PATCH renumbers everything to 1..N
  // the next time rows are dragged.
  const { data: minData } = await supabase
    .from('love_entries')
    .select('sort_order')
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .limit(1)
  const currentMin = (minData?.[0] as { sort_order?: number | null } | undefined)?.sort_order
  // No rows yet, or a legacy row with a null sort_order: start at 1.
  const sortOrder = typeof currentMin === 'number' ? currentMin - 1 : 1
  const { data, error } = await supabase
    .from('love_entries')
    .insert({
      author,
      role: (body.role ?? '').trim(),
      linkedin_url: (body.linkedinUrl ?? '').trim(),
      sort_order: sortOrder,
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
