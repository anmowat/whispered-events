import { NextRequest, NextResponse } from 'next/server'
import {
  checkDuplicate,
  createEvent,
  updateEvent,
  updateLastContribution,
  getEventHostEmail,
  getPartnerUserByEmail,
} from '@/lib/airtable'
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

    // Resolve host linkage and enforce host protection
    let hostUserId: string | undefined
    if (dupCheck.isDuplicate && dupCheck.existingId) {
      const existingHostEmail = await getEventHostEmail(dupCheck.existingId)
      if (existingHostEmail) {
        const submitterEmail = (event.submitter || '').toLowerCase()
        if (submitterEmail !== existingHostEmail) {
          return NextResponse.json(
            { message: 'The event you shared already has a host. If you are actually the host, contact us at team@whisperedevents.com' },
            { status: 403 }
          )
        }
      } else if (event.host) {
        const partnerUser = await getPartnerUserByEmail(event.submitter || '')
        if (!partnerUser) {
          return NextResponse.json(
            { message: 'Only partners can claim events as host. If you want to partner with us visit the partner tab' },
            { status: 403 }
          )
        }
        hostUserId = partnerUser.id
      }
    } else if (event.host) {
      const partnerUser = await getPartnerUserByEmail(event.submitter || '')
      if (!partnerUser) {
        return NextResponse.json(
          { message: 'Only partners can claim events as host. If you want to partner with us visit the partner tab' },
          { status: 403 }
        )
      }
      hostUserId = partnerUser.id
    }

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
        await updateEvent(dupCheck.existingId, updates, hostUserId)
      }

      return NextResponse.json({
        status: 'duplicate',
        existingRecord: dupCheck.existingRecord,
        updatedFields: dupCheck.missingFields,
      })
    }

    const id = await createEvent(event, hostUserId)

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
