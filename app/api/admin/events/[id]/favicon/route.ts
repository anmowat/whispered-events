import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin-auth'

export const runtime = 'nodejs'

const BUCKET = 'event-images'
const MAX_BYTES = 1 * 1024 * 1024

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const eventId = params.id
  if (!eventId) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `file too large (max ${MAX_BYTES / 1024}KB)` }, { status: 413 })
    }

    const bytes = await file.arrayBuffer()
    const contentType = file.type || 'image/png'
    const key = `${eventId}-favicon.png`

    const supabase = getSupabase()
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(key, bytes, { contentType, upsert: true })
    if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(key)
    const publicUrl = publicData?.publicUrl ?? ''
    if (!publicUrl) return NextResponse.json({ error: 'getPublicUrl returned empty' }, { status: 500 })

    const { error: updateErr } = await supabase
      .from('events')
      .update({ favicon_url: publicUrl })
      .eq('id', eventId)
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, faviconUrl: publicUrl })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const eventId = params.id
  if (!eventId) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    const supabase = getSupabase()
    await supabase.storage.from(BUCKET).remove([`${eventId}-favicon.png`])
    const { error: updateErr } = await supabase
      .from('events')
      .update({ favicon_url: '' })
      .eq('id', eventId)
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
