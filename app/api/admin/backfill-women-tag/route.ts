import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdmin } from '@/lib/admin-auth'
import { inferLikelyGender } from '@/lib/gender'

// One-shot backfill: walk every user, infer gender from first_name (falling
// back to full name), and append "Women" to the interest field for anyone
// whose name reads as female and whose topics don't already include it.
//
// Going forward, updateUserAdmin auto-tags on every name write — so this
// endpoint only needs to run once to clean up historical rows. Safe to
// re-run: skips users already tagged.
//
// Admin-gated via isAdmin (cookie session). Body is empty; the response
// includes a count plus a sampling of which users got tagged so admin can
// spot-check before trusting the heuristic at scale.

const WOMEN_TOPIC_RE = /\bwomen\b|\bwomxn\b|\bfemale\b/i

export const maxDuration = 60

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, first_name, interest')
    .is('airtable_deleted_at', null)
    .is('deleted_at', null)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const candidates: Array<{ id: string; email: string; nextInterest: string }> = []
  for (const row of data ?? []) {
    const r = row as {
      id: string
      email: string | null
      name: string | null
      first_name: string | null
      interest: string | null
    }
    const inferenceSource = r.first_name || r.name || ''
    if (inferLikelyGender(inferenceSource) !== 'female') continue
    const interest = String(r.interest ?? '')
    if (WOMEN_TOPIC_RE.test(interest)) continue
    const trimmed = interest.trim()
    candidates.push({
      id: r.id,
      email: r.email ?? '',
      nextInterest: trimmed ? `${trimmed}, Women` : 'Women',
    })
  }

  // Sequential writes — the volume here is at most a few hundred rows on
  // first run, then zero on every re-run. Not worth parallelizing.
  let updated = 0
  const failed: Array<{ id: string; error: string }> = []
  for (const c of candidates) {
    const { error: updateErr } = await supabase
      .from('users')
      .update({ interest: c.nextInterest })
      .eq('id', c.id)
    if (updateErr) {
      failed.push({ id: c.id, error: updateErr.message })
    } else {
      updated++
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: data?.length ?? 0,
    candidates: candidates.length,
    updated,
    failed,
    // First 20 ids+emails so admin can spot-check the heuristic on real
    // users before trusting it at scale.
    sample: candidates.slice(0, 20).map((c) => ({ id: c.id, email: c.email })),
  })
}
