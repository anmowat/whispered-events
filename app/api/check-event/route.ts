import { NextRequest, NextResponse } from 'next/server'
import { checkDuplicate, getEventHostEmail } from '@/lib/airtable'
import { parseEventInput } from '@/lib/parse-event'
import { EventRecord, ParsedEvent } from '@/lib/types'

export const maxDuration = 30

type CheckResponse =
  | { status: 'new'; parsed: ParsedEvent }
  | { status: 'duplicate-not-host' }
  | {
      status: 'duplicate-host'
      existingId: string
      merged: Partial<EventRecord>
    }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { input, email } = body as { input?: string; email?: string }

    if (!input?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'input and email are required' }, { status: 400 })
    }

    const { parsed, isUrl } = await parseEventInput(input.trim())
    const link = parsed.link || (isUrl ? input.trim() : '')
    const dup = await checkDuplicate(parsed.name || '', link, parsed.date)

    if (!dup.isDuplicate || !dup.existingId) {
      const response: CheckResponse = {
        status: 'new',
        parsed: { ...parsed, link },
      }
      return NextResponse.json(response)
    }

    const hostEmail = await getEventHostEmail(dup.existingId)
    const submitterEmail = email.trim().toLowerCase()

    // Only allow editing when the submitter's email matches the existing host.
    // No host on file, or different host -> polite rejection.
    if (!hostEmail || hostEmail !== submitterEmail) {
      const response: CheckResponse = { status: 'duplicate-not-host' }
      return NextResponse.json(response)
    }

    const existing = dup.existingRecord || {}
    const merged: Partial<EventRecord> = {
      name: existing.name || parsed.name || '',
      type: existing.type || parsed.type || 'Other',
      date: existing.date || parsed.date || '',
      location: existing.location || parsed.location || '',
      description: existing.description || parsed.description || '',
      link: existing.link || link,
      audience: existing.audience?.length ? existing.audience : parsed.audience || [],
    }

    const response: CheckResponse = {
      status: 'duplicate-host',
      existingId: dup.existingId,
      merged,
    }
    return NextResponse.json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('check-event error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
