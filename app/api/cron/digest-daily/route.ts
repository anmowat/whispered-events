import { NextRequest, NextResponse } from 'next/server'
import { runDailyArriveDigests } from '@/lib/digest'

// Daily cron for "As they arrive" users. Mirrors /api/cron/digest's
// shape and auth — same CRON_SECRET bearer, same maxDuration. The
// scheduling difference (daily at 14:00 UTC vs Monday at 01:00 UTC)
// lives in vercel.json.

export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error('cron/digest-daily: CRON_SECRET not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const stats = await runDailyArriveDigests(new Date())
    console.log('cron/digest-daily: completed', stats)
    return NextResponse.json({ ok: true, stats })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('cron/digest-daily: error', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
