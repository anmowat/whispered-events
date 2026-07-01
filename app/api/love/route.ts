import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const revalidate = 3600

function getClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function GET() {
  try {
    const supabase = getClient()
    const { data, error } = await supabase
      .from('love_entries')
      .select('id, author, role, image_url, linkedin_url')
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw error
    const entries = (data ?? []).map((row) => ({
      id: row.id as string,
      author: row.author as string,
      role: row.role as string,
      imageUrl: row.image_url as string,
      linkedinUrl: row.linkedin_url as string,
    }))
    return NextResponse.json({ entries })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('GET /api/love error:', message)
    return NextResponse.json({ entries: [], error: message })
  }
}
