import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { upsertPartnerApplication, PartnerApplication } from '@/lib/airtable'
import { notifyPartnerApplication } from '@/lib/slack'

// Receives a finished Partner-tab application. Validates input shape and
// email format, then delegates the dedupe + write to lib/airtable.
// Admins still manually flip Status to 'Partner' in Airtable after review.

export const maxDuration = 30

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  let body: Partial<PartnerApplication>
  try {
    body = (await req.json()) as Partial<PartnerApplication>
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const email = body.email?.trim() || ''
  const company = body.company?.trim() || ''
  const audience = body.audience?.trim() || ''
  const partnershipType = body.partnershipType?.trim() || ''
  const description = body.description?.trim() || ''

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'valid email is required' }, { status: 400 })
  }
  if (!company || !audience || !partnershipType || !description) {
    return NextResponse.json(
      { error: 'company, audience, partnershipType, and description are required' },
      { status: 400 },
    )
  }

  try {
    const { partnerId, isNew } = await upsertPartnerApplication({
      email,
      company,
      audience,
      partnershipType,
      description,
    })

    // New applications only, so correcting a typo and resubmitting doesn't
    // ping twice. Backgrounded, so a Slack outage can't fail an application.
    if (isNew) {
      waitUntil(
        notifyPartnerApplication({ company, email, audience, partnershipType, description }).catch(
          (e) => console.error('submit-partner: notifyPartnerApplication failed', e),
        ),
      )
    }

    return NextResponse.json({ ok: true, partnerId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('submit-partner error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
