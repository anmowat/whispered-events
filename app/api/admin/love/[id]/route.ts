import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin-auth'

//   PATCH  /api/admin/love/[id]   → { author?, role?, linkedinUrl? } update fields
//   DELETE /api/admin/love/[id]   → soft-delete

function getClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let body: { author?: string; role?: string; linkedinUrl?: string }
  try {
    body = (await req.json()) as { author?: string; role?: string; linkedinUrl?: string }
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const update: Record<string, string> = { updated_at: new Date().toISOString() }
  if (typeof body.author === 'string') update.author = body.author.trim()
  if (typeof body.role === 'string') update.role = body.role.trim()
  if (typeof body.linkedinUrl === 'string') update.linkedin_url = body.linkedinUrl.trim()

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }

  const supabase = getClient()
  const { data, error } = await supabase
    .from('love_entries')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    console.error(`PATCH /api/admin/love/${id} error:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ entry: data })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = getClient()
  const { error } = await supabase
    .from('love_entries')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error(`DELETE /api/admin/love/${id} error:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
