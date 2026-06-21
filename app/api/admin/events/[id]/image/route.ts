import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin-auth'
import { updateEvent } from '@/lib/airtable'

// Admin-only image management for an event. Mirrors Phase A's sync flow but
// initiated by a human: upload bytes -> Supabase Storage -> events.image_url
// -> Airtable Image attachment, so the next bulk sync re-uploads the same
// bytes idempotently. Delete clears all three.
//
// Cookie-session admin gate (lib/admin-auth.ts), same as every other admin
// route. Bucket and column were provisioned by the Phase A migration
// (supabase/migrations/20260621120000_event_images_bucket.sql).

export const runtime = 'nodejs'

const BUCKET = 'event-images'
const MAX_BYTES = 4 * 1024 * 1024

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
  if (!eventId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

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
    const key = `${eventId}.jpg`

    const supabase = getSupabase()
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(key, bytes, { contentType, upsert: true })
    if (uploadErr) {
      console.error(`admin image upload(${eventId}) failed:`, uploadErr)
      return NextResponse.json({ error: uploadErr.message }, { status: 500 })
    }

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(key)
    const publicUrl = publicData?.publicUrl ?? ''
    if (!publicUrl) {
      return NextResponse.json({ error: 'getPublicUrl returned empty' }, { status: 500 })
    }

    const { error: updateErr } = await supabase
      .from('events')
      .update({ image_url: publicUrl })
      .eq('id', eventId)
    if (updateErr) {
      console.error(`admin image image_url update(${eventId}) failed:`, updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    // Mirror to Airtable so the next bulk sync converges on the same bytes
    // instead of clobbering our manual upload with a stale (or absent)
    // Airtable Image field. Airtable fetches asynchronously from publicUrl.
    await updateEvent(eventId, { image: publicUrl })

    return NextResponse.json({ ok: true, image_url: publicUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin image POST error:', message)
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
  const eventId = params.id
  if (!eventId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  try {
    const supabase = getSupabase()
    const key = `${eventId}.jpg`

    // Storage remove is non-fatal — the object may already be missing if
    // the upload race-lost. Whatever the outcome, we still want to clear
    // the column and Airtable so the UI reflects "no image".
    const { error: removeErr } = await supabase.storage.from(BUCKET).remove([key])
    if (removeErr) {
      console.error(`admin image remove(${eventId}) failed:`, removeErr)
    }

    const { error: updateErr } = await supabase
      .from('events')
      .update({ image_url: '' })
      .eq('id', eventId)
    if (updateErr) {
      console.error(`admin image image_url clear(${eventId}) failed:`, updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    await updateEvent(eventId, { image: '' })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin image DELETE error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
