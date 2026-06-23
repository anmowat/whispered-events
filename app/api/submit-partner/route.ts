import { NextRequest, NextResponse } from 'next/server'
import { upsertPartnerApplication, PartnerApplication } from '@/lib/airtable'

// Receives a finished Partner-tab application. Validates input shape and a
// few high-signal fields (email format, LinkedIn looks real) then delegates
// the dedupe + write to lib/airtable. Admins still manually flip Status to
// 'Partner' in Airtable after reviewing.

export const maxDuration = 30

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Accept linkedin.com/in/... and linkedin.com/company/... (with or without
// protocol or www). Strict enough to catch typos, permissive enough to
// accept regional subdomains (uk.linkedin.com, etc.) and tracking params.
const LINKEDIN_RE = /(^|\.)linkedin\.com\/(in|company|pub)\//i

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
  const description = body.description?.trim() || ''
  const linkedin = body.linkedin?.trim() || ''

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'valid email is required' }, { status: 400 })
  }
  if (!company || !audience || !description) {
    return NextResponse.json(
      { error: 'company, audience, and description are required' },
      { status: 400 },
    )
  }
  if (!linkedin || !LINKEDIN_RE.test(linkedin)) {
    return NextResponse.json(
      { error: 'linkedin must be a linkedin.com profile or company URL' },
      { status: 400 },
    )
  }

  try {
    const { partnerId } = await upsertPartnerApplication({
      email,
      company,
      audience,
      description,
      linkedin,
    })
    return NextResponse.json({ ok: true, partnerId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('submit-partner error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
