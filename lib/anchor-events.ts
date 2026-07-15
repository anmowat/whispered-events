import { createClient } from '@supabase/supabase-js'
import { getEventById } from './events'
import { getOfferById, type Offer } from './offers'
import type { AirtableEvent } from './airtable'

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    global: {
      fetch: (url: RequestInfo | URL, options: RequestInit = {}) =>
        fetch(url, { ...options, cache: 'no-store' }),
    },
  })
}

export interface AnchorEvent {
  id: string
  slug: string
  title: string
  anchorName: string
  anchorUrl: string
  anchorIconUrl: string
  description: string
  status: 'draft' | 'live'
  createdAt: string
  updatedAt: string
}

interface AnchorEventRow {
  id: string
  slug: string
  title: string
  anchor_name: string
  anchor_url: string
  anchor_icon_url: string
  description: string
  status: string
  created_at: string
  updated_at: string
}

function toAnchorEvent(row: AnchorEventRow): AnchorEvent {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    anchorName: row.anchor_name,
    anchorUrl: row.anchor_url,
    anchorIconUrl: row.anchor_icon_url,
    description: row.description,
    status: (row.status ?? '').trim().toLowerCase() === 'live' ? 'live' : 'draft',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listAnchorEvents(): Promise<AnchorEvent[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('anchor_events')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listAnchorEvents: ${error.message}`)
  return (data as AnchorEventRow[]).map(toAnchorEvent)
}

export async function getAnchorEventById(id: string): Promise<AnchorEvent | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('anchor_events')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`getAnchorEventById: ${error.message}`)
  return data ? toAnchorEvent(data as AnchorEventRow) : null
}

export async function getAnchorEventBySlug(slug: string): Promise<AnchorEvent | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('anchor_events')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(`getAnchorEventBySlug: ${error.message}`)
  return data ? toAnchorEvent(data as AnchorEventRow) : null
}

export async function getAnchorEventEvents(anchorEventId: string): Promise<AirtableEvent[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('anchor_event_events')
    .select('event_id')
    .eq('anchor_event_id', anchorEventId)
    .order('position', { ascending: true })
  if (error) throw new Error(`getAnchorEventEvents: ${error.message}`)
  const rows = data as Array<{ event_id: string }>
  const events = await Promise.all(rows.map((r) => getEventById(r.event_id)))
  return events.filter((e): e is AirtableEvent => e !== null)
}

export async function getAnchorEventOffers(anchorEventId: string): Promise<Offer[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('anchor_event_offers')
    .select('offer_id')
    .eq('anchor_event_id', anchorEventId)
    .order('position', { ascending: true })
  if (error) throw new Error(`getAnchorEventOffers: ${error.message}`)
  const rows = data as Array<{ offer_id: string }>
  const offers = await Promise.all(rows.map((r) => getOfferById(r.offer_id)))
  return offers.filter((o): o is Offer => o !== null)
}

// Returns event ids in position order for the admin UI
export async function getAnchorEventEventIds(anchorEventId: string): Promise<string[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('anchor_event_events')
    .select('event_id')
    .eq('anchor_event_id', anchorEventId)
    .order('position', { ascending: true })
  if (error) throw new Error(`getAnchorEventEventIds: ${error.message}`)
  return (data as Array<{ event_id: string }>).map((r) => r.event_id)
}

// Returns offer ids in position order for the admin UI
export async function getAnchorEventOfferIds(anchorEventId: string): Promise<string[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('anchor_event_offers')
    .select('offer_id')
    .eq('anchor_event_id', anchorEventId)
    .order('position', { ascending: true })
  if (error) throw new Error(`getAnchorEventOfferIds: ${error.message}`)
  return (data as Array<{ offer_id: string }>).map((r) => r.offer_id)
}

export interface AnchorEventInput {
  slug?: string
  title?: string
  anchorName?: string
  anchorUrl?: string
  anchorIconUrl?: string
  description?: string
  status?: 'draft' | 'live'
}

export async function createAnchorEvent(input: AnchorEventInput): Promise<AnchorEvent> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('anchor_events')
    .insert({
      slug: input.slug ?? '',
      title: input.title ?? '',
      anchor_name: input.anchorName ?? '',
      anchor_url: input.anchorUrl ?? '',
      anchor_icon_url: input.anchorIconUrl ?? '',
      description: input.description ?? '',
      status: input.status ?? 'draft',
    })
    .select()
    .single()
  if (error) throw new Error(`createAnchorEvent: ${error.message}`)
  return toAnchorEvent(data as AnchorEventRow)
}

export async function updateAnchorEvent(
  id: string,
  input: AnchorEventInput,
): Promise<AnchorEvent | null> {
  const supabase = getSupabase()
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.slug !== undefined) fields.slug = input.slug
  if (input.title !== undefined) fields.title = input.title
  if (input.anchorName !== undefined) fields.anchor_name = input.anchorName
  if (input.anchorUrl !== undefined) fields.anchor_url = input.anchorUrl
  if (input.anchorIconUrl !== undefined) fields.anchor_icon_url = input.anchorIconUrl
  if (input.description !== undefined) fields.description = input.description
  if (input.status !== undefined) fields.status = input.status
  const { data, error } = await supabase
    .from('anchor_events')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(`updateAnchorEvent: ${error.message}`)
  return data ? toAnchorEvent(data as AnchorEventRow) : null
}

// Replaces the full event list for an anchor event (delete + re-insert)
export async function setAnchorEventEvents(
  anchorEventId: string,
  orderedEventIds: string[],
): Promise<void> {
  const supabase = getSupabase()
  const { error: delError } = await supabase
    .from('anchor_event_events')
    .delete()
    .eq('anchor_event_id', anchorEventId)
  if (delError) throw new Error(`setAnchorEventEvents delete: ${delError.message}`)
  if (orderedEventIds.length === 0) return
  const rows = orderedEventIds.map((event_id, i) => ({
    anchor_event_id: anchorEventId,
    event_id,
    position: i,
  }))
  const { error: insError } = await supabase.from('anchor_event_events').insert(rows)
  if (insError) throw new Error(`setAnchorEventEvents insert: ${insError.message}`)
}

// Replaces the full offer list for an anchor event (delete + re-insert)
export async function setAnchorEventOffers(
  anchorEventId: string,
  orderedOfferIds: string[],
): Promise<void> {
  const supabase = getSupabase()
  const { error: delError } = await supabase
    .from('anchor_event_offers')
    .delete()
    .eq('anchor_event_id', anchorEventId)
  if (delError) throw new Error(`setAnchorEventOffers delete: ${delError.message}`)
  if (orderedOfferIds.length === 0) return
  const rows = orderedOfferIds.map((offer_id, i) => ({
    anchor_event_id: anchorEventId,
    offer_id,
    position: i,
  }))
  const { error: insError } = await supabase.from('anchor_event_offers').insert(rows)
  if (insError) throw new Error(`setAnchorEventOffers insert: ${insError.message}`)
}
