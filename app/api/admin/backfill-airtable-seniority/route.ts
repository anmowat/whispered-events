import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { backfillSeniorityToAirtable } from '@/lib/airtable'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const body = await req.json().catch(() => ({})) as { id?: unknown }
    const eventId = typeof body.id === 'string' ? body.id : undefined
    const result = await backfillSeniorityToAirtable(eventId)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('backfill-airtable-seniority error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
