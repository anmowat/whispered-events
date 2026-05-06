import { NextRequest, NextResponse } from 'next/server'
import {
  checkDuplicate,
  createEvent,
  updateEvent,
  updateLastContribution,
  getEventHostEmail,
  getPartnerUserByEmail,
} from '@/lib/airtable'
import { EventRecord, VIRTUAL_LOCATION_RE } from '@/lib/types'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { event, existingId } = body as { event: EventRecord; existingId?: string }

    if (!event.name || !event.link) {
      return NextResponse.json(
        { error: 'Event name and link are required' },
        { status: 400 }
      )
    }
    if (!event.submitter) {
      return NextResponse.json(
        { error: 'Submitter email is required' },
        { status: 400 }
      )
    }

    if (event.type === 'Virtual' || VIRTUAL_LOCATION_RE.test(event.location || '')) {
      return NextResponse.json(
        {
          error:
            'We no longer accept virtual events. Please submit only in-person events with a specific city.',
        },
        { status: 400 }
      )
    }

    const submitterEmail = event.submitter.toLowerCase()

    // Update path — only allowed when submitter's email matches the existing host
    if (existingId) {
      const hostEmail = await getEventHostEmail(existingId)
      if (!hostEmail || hostEmail !== submitterEmail) {
        return NextResponse.json(
          { error: 'You are not the host of this event.' },
          { status: 403 }
        )
      }

      await updateEvent(existingId, {
        name: event.name,
        type: event.type,
        date: event.date,
        location: event.location,
        description: event.description,
        audience: event.audience,
        submitter: event.submitter,
      })

      updateLastContribution(event.submitter).catch((e) =>
        console.error('updateLastContribution error:', e)
      )

      return NextResponse.json({ status: 'updated', id: existingId })
    }

    // Create path — defense-in-depth duplicate check
    const dupCheck = await checkDuplicate(event.name, event.link, event.date)
    if (dupCheck.isDuplicate) {
      return NextResponse.json(
        {
          error:
            'This event already exists. Please refresh and submit again so we can pick up the latest record.',
        },
        { status: 409 }
      )
    }

    // Host claim handling for new events
    let hostUserId: string | undefined
    if (event.host) {
      const partnerUser = await getPartnerUserByEmail(event.submitter)
      if (!partnerUser) {
        return NextResponse.json(
          {
            message:
              'Only partners can claim events as host. If you want to partner with us visit the partner tab',
          },
          { status: 403 }
        )
      }
      hostUserId = partnerUser.id
    }

    const id = await createEvent(event, hostUserId)

    updateLastContribution(event.submitter).catch((e) =>
      console.error('updateLastContribution error:', e)
    )

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    fetch(`${appUrl}/api/process-matches?trigger=event&id=${id}`).catch((e) =>
      console.error('process-matches fire-and-forget error:', e)
    )

    return NextResponse.json({ status: 'created', id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('submit-event error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
