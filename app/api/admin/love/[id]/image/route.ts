import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin-auth'

// Admin image upload/delete for love page entries.
// Mirrors app/api/admin/events/[id]/image/route.ts — bytes go to
// Supabase Storage (love-images bucket), public URL is written back
// to love_entries.image_url.

export const runtime = 'nodejs'

const BUCKET = 'love-images'
const MAX_BYTES = 4 * 1024 * 1024

function getClient() {
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
  const { id } = params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `file too large (max ${MAX_BYTES / 1024 / 1024}MB)` },
        { status: 413 },
      )
    }

    const bytes = await file.arrayBuffer()
    const contentType = file.type || 'image/jpeg'
    const key = `${id}.jpg`

    const supabase = getClient()
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(key, bytes, { contentType, upsert: true })
    if (uploadErr) {
      console.error(`love image upload(${id}) failed:`, uploadErr)
      return NextResponse.json({ error: uploadErr.message }, { status: 500 })
    }

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(key)
    const publicUrl = publicData?.publicUrl ?? ''
    if (!publicUrl) {
      return NextResponse.json({ error: 'getPublicUrl returned empty' }, { status: 500 })
    }

    const { error: updateErr } = await supabase
      .from('love_entries')
      .update({ image_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (updateErr) {
      console.error(`love image image_url update(${id}) failed:`, updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, imageUrl: publicUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('love image POST error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
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

  try {
    const supabase = getClient()
    const key = `${id}.jpg`

    const { error: removeErr } = await supabase.storage.from(BUCKET).remove([key])
    if (removeErr) {
      console.error(`love image remove(${id}) failed:`, removeErr)
    }

    const { error: updateErr } = await supabase
      .from('love_entries')
      .update({ image_url: '', updated_at: new Date().toISOString() })
      .eq('id', id)
    if (updateErr) {
      console.error(`love image image_url clear(${id}) failed:`, updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('love image DELETE error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
