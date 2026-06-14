import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { seedTopicsIfEmpty } from '@/lib/supabase'
import { DEFAULT_TOPICS } from '@/lib/topics'

// One-shot seed used by the "Seed defaults" button on /admin/topics.
// No-op if the table already has rows so a stray double-click can't
// duplicate-insert.

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const inserted = await seedTopicsIfEmpty(DEFAULT_TOPICS)
  return NextResponse.json({ inserted })
}
