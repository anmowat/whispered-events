import { NextRequest, NextResponse } from 'next/server'
import { isAdmin } from '@/lib/admin-auth'
import { getEventFlags } from '@/lib/events'
import { updateEvent } from '@/lib/airtable'

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

  try {
    await Promise.all(
      allEventIds.map(async (eventId) => {
        const flags = await getEventFlags(eventId)
        if (!flags) return
        let hostIds = [...(flags.host_ids ?? [])]
        if (toAdd.includes(eventId) && !hostIds.includes(userId)) {
          hostIds.push(userId)
        }
        if (toRemove.includes(eventId)) {
          hostIds = hostIds.filter((id) => id !== userId)
        }
        await updateEvent(eventId, {}, hostIds)
      }),
    )
    return NextResponse.json({ ok: true, changed: allEventIds.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('admin/users/[id]/hosted-events error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
