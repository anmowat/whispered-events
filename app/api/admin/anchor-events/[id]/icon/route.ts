import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin-auth'
import { updateAnchorEvent } from '@/lib/anchor-events'

export const runtime = 'nodejs'

const BUCKET = 'event-images'
const MAX_BYTES = 4 * 1024 * 1024

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `file too large (max ${MAX_BYTES / 1024 / 1024}MB)` }, { status: 413 })
    }

    const bytes = await file.arrayBuffer()
    const contentType = file.type || 'image/png'
    const key = `anchor-icon-${id}.jpg`

    const supabase = getSupabase()
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(key, bytes, { contentType, upsert: true })
    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 })
    }

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(key)
    const publicUrl = publicData?.publicUrl ?? ''
    if (!publicUrl) {
      return NextResponse.json({ error: 'getPublicUrl returned empty' }, { status: 500 })
    }

    await updateAnchorEvent(id, { anchorIconUrl: publicUrl })
    return NextResponse.json({ ok: true, anchor_icon_url: publicUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    const supabase = getSupabase()
    await supabase.storage.from(BUCKET).remove([`anchor-icon-${id}.jpg`])
    await updateAnchorEvent(id, { anchorIconUrl: '' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
