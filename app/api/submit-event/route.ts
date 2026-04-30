import { NextRequest, NextResponse } from 'next/server'
import { checkDuplicate, createEvent, updateEvent } from '@/lib/airtable'
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
      // Update missing fields on the existing record
      if (dupCheck.existingId && dupCheck.missingFields?.length) {
        const updates: Partial<EventRecord> = {}
        for (const field of dupCheck.missingFields) {
          const key = field as keyof EventRecord
          if (event[key] !== undefined) {
            ;(updates as Record<string, unknown>)[key] = event[key]
          }
        }
        if (Object.keys(updates).length > 0) {
          await updateEvent(dupCheck.existingId, updates)
        }
      }

      return NextResponse.json({
        status: 'duplicate',
        existingRecord: dupCheck.existingRecord,
        updatedFields: dupCheck.missingFields,
      })
    }

    const id = await createEvent(event)
    return NextResponse.json({ status: 'created', id })
  } catch (err) {
    console.error('submit-event error:', err)
    return NextResponse.json(
      { error: 'Failed to submit event' },
      { status: 500 }
    )
  }
}
