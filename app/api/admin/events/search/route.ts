import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const q = req.nextUrl.searchParams.get('q') || ''
  if (!q.trim()) return NextResponse.json({ results: [] })

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('events')
    .select('id, name, date, location, type')
    .ilike('name', `%${q}%`)
    .is('deleted_at', null)
    .is('airtable_deleted_at', null)
    .order('date', { ascending: true })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    results: (data ?? []).map((e) => ({
      id: e.id as string,
      name: e.name as string,
      date: e.date as string,
      location: e.location as string,
      type: e.type as string,
    })),
  })
}
