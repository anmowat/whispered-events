import { NextResponse } from 'next/server'
import { getPartners } from '@/lib/airtable'

export const revalidate = 86400 // cache for 24 hours

export async function GET() {
  try {
    const partners = await getPartners()
    return NextResponse.json({ partners })
  } catch (err) {
    console.error('partners error:', err)
    return NextResponse.json({ partners: [], error: String(err) })
  }
}
