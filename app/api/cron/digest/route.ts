import { NextRequest, NextResponse } from 'next/server'
import { runDigests } from '@/lib/digest'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error('cron/digest: CRON_SECRET not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const stats = await runDigests(new Date())
    console.log('cron/digest: completed', stats)
    return NextResponse.json({ ok: true, stats })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('cron/digest: error', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
