import { NextRequest, NextResponse } from 'next/server'
import { checkDuplicate, createEvent, updateEvent, updateLastContribution } from '@/lib/airtable'
import { EventRecord } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { event, force } = body as { event: EventRecord; force?: boolean }

    if (!event.name || !event.link) {
      return NextResponse.json(
        { error: 'Event name and link are required' },
        { status: 400 }
      )
    }

    const dupCheck = await checkDuplicate(event.name, event.link, event.date)

    if (dupCheck.isDuplicate && !force) {
      // Update missing fields and always update Submitter to latest email
      if (dupCheck.existingId) {
        const updates: Partial<EventRecord> = { submitter: event.submitter }
        for (const field of dupCheck.missingFields || []) {
          const key = field as keyof EventRecord
          if (event[key] !== undefined) {
            ;(updates as Record<string, unknown>)[key] = event[key]
          }
        }
        await updateEvent(dupCheck.existingId, updates)
      }

      return NextResponse.json({
        status: 'duplicate',
        existingRecord: dupCheck.existingRecord,
        updatedFields: dupCheck.missingFields,
      })
    }

    const id = await createEvent(event)

    // Fire-and-forget: update contributor record and trigger matching
    if (event.submitter) {
      updateLastContribution(event.submitter).catch((e) =>
        console.error('updateLastContribution error:', e)
      )
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    fetch(`${appUrl}/api/process-matches?trigger=event&id=${id}`).catch((e) =>
      console.error('process-matches fire-and-forget error:', e)
    )

    return NextResponse.json({ status: 'created', id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('submit-event error:', message)
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
