import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export interface Offer {
  id: string
  name: string
  logoUrl: string
  bannerUrl: string
  ctaText: string
  url: string
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

interface OfferRow {
  id: string
  name: string
  logo_url: string
  banner_url: string
  cta_text: string
  url: string
  status: string
  created_at: string
  updated_at: string
}

function toOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    ctaText: row.cta_text,
    url: row.url,
    status: row.status === 'inactive' ? 'inactive' : 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listOffers(): Promise<Offer[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('offers')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listOffers: ${error.message}`)
  return (data as OfferRow[]).map(toOffer)
}

export async function getOfferById(id: string): Promise<Offer | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('offers')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`getOfferById: ${error.message}`)
  return data ? toOffer(data as OfferRow) : null
}

export interface OfferInput {
  name?: string
  logoUrl?: string
  bannerUrl?: string
  ctaText?: string
  url?: string
  status?: 'active' | 'inactive'
}

export async function createOffer(input: OfferInput): Promise<Offer> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('offers')
    .insert({
      name: input.name ?? '',
      logo_url: input.logoUrl ?? '',
      banner_url: input.bannerUrl ?? '',
      cta_text: input.ctaText ?? '',
      url: input.url ?? '',
      status: input.status ?? 'active',
    })
    .select()
    .single()
  if (error) throw new Error(`createOffer: ${error.message}`)
  return toOffer(data as OfferRow)
}

export async function updateOffer(id: string, input: OfferInput): Promise<Offer | null> {
  const supabase = getSupabase()
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.name !== undefined) fields.name = input.name
  if (input.logoUrl !== undefined) fields.logo_url = input.logoUrl
  if (input.bannerUrl !== undefined) fields.banner_url = input.bannerUrl
  if (input.ctaText !== undefined) fields.cta_text = input.ctaText
  if (input.url !== undefined) fields.url = input.url
  if (input.status !== undefined) fields.status = input.status
  const { data, error } = await supabase
    .from('offers')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(`updateOffer: ${error.message}`)
  return data ? toOffer(data as OfferRow) : null
}
