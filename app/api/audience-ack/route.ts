import { NextRequest, NextResponse } from 'next/server'
import { generateAudienceAck } from '@/lib/claude'

// Used by the Partner apply chat after step 3 (audience) so the bot can show
// it actually understands the audience before asking for event volume.
// Falls back to a generic ack on any error — the chat flow must never block
// on this lookup.

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const { audience } = (await req.json()) as { audience?: string }
    const ack = await generateAudienceAck(audience || '')
    return NextResponse.json({ ack })
  } catch (err) {
    console.error('audience-ack error:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ack: 'Got it.' })
  }
}
