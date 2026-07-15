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
  shortName: string
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
  short_name: string
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
    shortName: row.short_name ?? '',
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

export interface AnchorEventEventMeta {
  /** startTime from the junction table (admin override), falls back to event.startTime */
  startTime: string | null
  featured: boolean
}

export async function getAnchorEventEvents(
  anchorEventId: string,
): Promise<Array<AirtableEvent & AnchorEventEventMeta>> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('anchor_event_events')
    .select('event_id, start_time, featured')
    .eq('anchor_event_id', anchorEventId)
  if (error) throw new Error(`getAnchorEventEvents: ${error.message}`)
  const rows = data as Array<{ event_id: string; start_time: string | null; featured: boolean }>
  const events = await Promise.all(
    rows.map(async (r) => {
      const ev = await getEventById(r.event_id)
      if (!ev) return null
      // Use junction table start_time override if set, otherwise fall back to event's own startTime
      const startTime = r.start_time ?? (ev as { startTime?: string }).startTime ?? null
      return { ...ev, startTime, featured: r.featured ?? false }
    }),
  )
  const valid = events.filter((e): e is AirtableEvent & AnchorEventEventMeta => e !== null)
  // Sort: featured first, then by start_time ascending (nulls last), then by name
  return valid.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime)
    if (a.startTime) return -1
    if (b.startTime) return 1
    return a.name.localeCompare(b.name)
  })
}

// Update start_time and/or featured on a single junction row
export async function updateAnchorEventEventMeta(
  anchorEventId: string,
  eventId: string,
  fields: Partial<{ startTime: string | null; featured: boolean }>,
): Promise<void> {
  const supabase = getSupabase()
  const update: Record<string, unknown> = {}
  if ('startTime' in fields) update.start_time = fields.startTime ?? null
  if ('featured' in fields) update.featured = fields.featured
  if (Object.keys(update).length === 0) return
  const { error } = await supabase
    .from('anchor_event_events')
    .update(update)
    .eq('anchor_event_id', anchorEventId)
    .eq('event_id', eventId)
  if (error) throw new Error(`updateAnchorEventEventMeta: ${error.message}`)
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

// Returns event ids for the admin UI
export async function getAnchorEventEventIds(anchorEventId: string): Promise<string[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('anchor_event_events')
    .select('event_id')
    .eq('anchor_event_id', anchorEventId)
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
  shortName?: string
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
      short_name: input.shortName ?? '',
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
  if (input.shortName !== undefined) fields.short_name = input.shortName
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

// Replaces the full event list for an anchor event, preserving start_time/featured on existing rows
export async function setAnchorEventEvents(
  anchorEventId: string,
  eventIds: string[],
): Promise<void> {
  const supabase = getSupabase()
  // Read existing metadata before deleting so we can restore it
  const { data: existing } = await supabase
    .from('anchor_event_events')
    .select('event_id, start_time, featured')
    .eq('anchor_event_id', anchorEventId)
  const metaMap = new Map<string, { start_time: string | null; featured: boolean }>()
  if (existing) {
    for (const r of existing as Array<{ event_id: string; start_time: string | null; featured: boolean }>) {
      metaMap.set(r.event_id, { start_time: r.start_time, featured: r.featured })
    }
  }
  const { error: delError } = await supabase
    .from('anchor_event_events')
    .delete()
    .eq('anchor_event_id', anchorEventId)
  if (delError) throw new Error(`setAnchorEventEvents delete: ${delError.message}`)
  if (eventIds.length === 0) return
  const rows = eventIds.map((event_id, i) => {
    const meta = metaMap.get(event_id)
    return {
      anchor_event_id: anchorEventId,
      event_id,
      position: i,
      start_time: meta?.start_time ?? null,
      featured: meta?.featured ?? false,
    }
  })
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

// Returns all anchor events that contain a given event_id
export async function getAnchorEventsForEvent(eventId: string): Promise<AnchorEvent[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('anchor_event_events')
    .select('anchor_event_id')
    .eq('event_id', eventId)
  if (error) throw new Error(`getAnchorEventsForEvent: ${error.message}`)
  const ids = (data as Array<{ anchor_event_id: string }>).map((r) => r.anchor_event_id)
  if (ids.length === 0) return []
  const results = await Promise.all(ids.map((id) => getAnchorEventById(id)))
  return results.filter((e): e is AnchorEvent => e !== null)
}

// Appends an event to an anchor event at the end (if not already present)
export async function addEventToAnchorEvent(anchorEventId: string, eventId: string): Promise<void> {
  const supabase = getSupabase()
  const { data: existing } = await supabase
    .from('anchor_event_events')
    .select('event_id')
    .eq('anchor_event_id', anchorEventId)
    .eq('event_id', eventId)
    .maybeSingle()
  if (existing) return
  const { data: rows } = await supabase
    .from('anchor_event_events')
    .select('position')
    .eq('anchor_event_id', anchorEventId)
    .order('position', { ascending: false })
    .limit(1)
  const nextPos = rows && rows.length > 0 ? (rows[0] as { position: number }).position + 1 : 0
  const { error } = await supabase
    .from('anchor_event_events')
    .insert({ anchor_event_id: anchorEventId, event_id: eventId, position: nextPos })
  if (error) throw new Error(`addEventToAnchorEvent: ${error.message}`)
}

// Removes an event from an anchor event
export async function removeEventFromAnchorEvent(anchorEventId: string, eventId: string): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('anchor_event_events')
    .delete()
    .eq('anchor_event_id', anchorEventId)
    .eq('event_id', eventId)
  if (error) throw new Error(`removeEventFromAnchorEvent: ${error.message}`)
}
