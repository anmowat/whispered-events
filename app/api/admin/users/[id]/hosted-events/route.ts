import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { isAdmin } from '@/lib/admin-auth'
import { getEventById } from '@/lib/events'
import { updateEvent } from '@/lib/airtable'
import { getUserById } from '@/lib/users'
import { sendHostAddedEmail } from '@/lib/email'

// Adds or removes a user as host for one or more events. Accepts a single
// request with { add?: string[], remove?: string[] } (arrays of event IDs).
// Each event's host_ids list is fetched, mutated, then written back via the
// same updateEvent path used by the event admin page.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const userId = params.id
  if (!userId) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as {
    add?: unknown
    remove?: unknown
  }

  const toAdd: string[] = Array.isArray(body.add) ? body.add.filter((x): x is string => typeof x === 'string') : []
  const toRemove: string[] = Array.isArray(body.remove) ? body.remove.filter((x): x is string => typeof x === 'string') : []

  if (toAdd.length === 0 && toRemove.length === 0) {
    return NextResponse.json({ ok: true, changed: 0 })
  }

  const allEventIds = Array.from(new Set([...toAdd, ...toRemove]))

  // Fetch the user once upfront so we have email/name for the host-added email.
  const hostUser = toAdd.length > 0 ? await getUserById(userId) : null

  try {
    await Promise.all(
      allEventIds.map(async (eventId) => {
        const event = await getEventById(eventId)
        if (!event) return
        let hostIds = [...(event.hostIds ?? [])]
        const wasAlreadyHost = hostIds.includes(userId)
        if (toAdd.includes(eventId) && !wasAlreadyHost) {
          hostIds.push(userId)
        }
        if (toRemove.includes(eventId)) {
          hostIds = hostIds.filter((id) => id !== userId)
        }
        await updateEvent(eventId, {}, hostIds)

        // Mirror the event-side behaviour: email the newly-added host.
        if (toAdd.includes(eventId) && !wasAlreadyHost && hostUser) {
          const firstName = (hostUser.firstName && hostUser.firstName !== 'DEFAULT')
            ? hostUser.firstName
            : (hostUser.name && hostUser.name !== 'DEFAULT')
              ? hostUser.name.split(' ')[0]
              : ''
          waitUntil(
            sendHostAddedEmail({ hostEmail: hostUser.email, hostFirstName: firstName, eventName: event.name ?? '', eventId })
              .catch((e) => console.error('sendHostAddedEmail failed', { email: hostUser.email, error: e })),
          )
        }
      }),
    )
    return NextResponse.json({ ok: true, changed: allEventIds.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/users/[id]/hosted-events error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
