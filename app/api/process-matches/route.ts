import { NextRequest, NextResponse } from 'next/server'
import {
  getActiveUsers,
  getFutureEvents,
  getUserByEmail,
  AirtableEvent,
  AirtableUser,
} from '@/lib/airtable'
import { scoreEventUser } from '@/lib/matching'
import { hasBeenNotified, logMatch } from '@/lib/supabase'
import { sendEventNotification, sendUserDigest } from '@/lib/email'

const SCORE_THRESHOLD = 0.6
const BATCH_SIZE = 50

async function processEventTrigger(eventId: string) {
  const events = await getFutureEvents()
  const event = events.find((e) => e.id === eventId)
  if (!event) {
    console.error(`process-matches: event ${eventId} not found`)
    return
  }

  const users = await getActiveUsers()
  console.log(`process-matches: scoring event "${event.name}" against ${users.length} users`)

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map((user) => scorAndNotify(event, user))
    )
  }
}

async function processUserTrigger(userId: string) {
  const users = await getActiveUsers()
  const user = users.find((u) => u.id === userId)

  // New users may not be Approved yet; fall back to fetching by ID
  let targetUser: AirtableUser | null = user ?? null
  if (!targetUser) {
    // User just signed up — not yet approved, fetch raw record
    console.log(`process-matches: user ${userId} not in active list, skipping digest`)
    return
  }

  const events = await getFutureEvents()
  console.log(`process-matches: scoring ${events.length} events for user "${targetUser.email}"`)

  const scored: Array<{ event: AirtableEvent; score: number }> = []

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (event) => {
        const { score } = await scoreEventUser(event, targetUser!)
        return { event, score }
      })
    )
    scored.push(...results.filter((r) => r.score >= SCORE_THRESHOLD))
  }

  const topMatches = scored.sort((a, b) => b.score - a.score).slice(0, 5)

  if (topMatches.length) {
    await sendUserDigest(targetUser, topMatches.map((m) => m.event))
    await Promise.all(
      topMatches.map((m) =>
        logMatch(m.event.id, targetUser!.id, targetUser!.email, m.score)
      )
    )
  }
}

async function scorAndNotify(event: AirtableEvent, user: AirtableUser) {
  try {
    const already = await hasBeenNotified(event.id, user.id)
    if (already) return

    const { score } = await scoreEventUser(event, user)
    if (score < SCORE_THRESHOLD) return

    await sendEventNotification(user, event)
    await logMatch(event.id, user.id, user.email, score)
  } catch (err) {
    console.error(`process-matches: error for user ${user.email} / event ${event.id}:`, err)
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const trigger = searchParams.get('trigger')
  const id = searchParams.get('id')

  if (!trigger || !id) {
    return NextResponse.json({ error: 'trigger and id are required' }, { status: 400 })
  }

  try {
    if (trigger === 'event') {
      await processEventTrigger(id)
    } else if (trigger === 'user') {
      await processUserTrigger(id)
    } else {
      return NextResponse.json({ error: 'trigger must be "event" or "user"' }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('process-matches error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
