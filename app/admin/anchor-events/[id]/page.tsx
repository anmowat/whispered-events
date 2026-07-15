'use client'

import { useEffect, useState } from 'react'
import LoginModal from '@/components/LoginModal'
import { AdminTabs } from '@/components/AdminTabs'

interface AnchorEvent {
  id: string
  slug: string
  title: string
  anchorName: string
  anchorUrl: string
  anchorIconUrl: string
  description: string
  status: 'draft' | 'live'
}

interface EventItem {
  id: string
  name: string
  date: string
  location: string
  type: string
}

interface OfferItem {
  id: string
  name: string
  ctaText: string
  status: string
}

interface PageData {
  item: AnchorEvent
  events: EventItem[]
  offers: OfferItem[]
}

export default function AdminAnchorEventDetailPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<PageData | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized'>('unknown')
  const [showLogin, setShowLogin] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Draft fields
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [anchorName, setAnchorName] = useState('')
  const [anchorUrl, setAnchorUrl] = useState('')
  const [anchorIconUrl, setAnchorIconUrl] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<'draft' | 'live'>('draft')

  // Icon upload state
  const [iconUploading, setIconUploading] = useState(false)
  const [iconError, setIconError] = useState<string | null>(null)

  // Event search
  const [eventSearch, setEventSearch] = useState('')
  const [eventResults, setEventResults] = useState<EventItem[]>([])
  const [eventSearching, setEventSearching] = useState(false)

  // Offer picker
  const [allOffers, setAllOffers] = useState<OfferItem[]>([])

  async function fetchData() {
    const res = await fetch(`/api/admin/anchor-events/${params.id}`, { cache: 'no-store' })
    if (res.status === 401) { setAuthState('unauthorized'); return }
    if (!res.ok) return
    const d = await res.json() as PageData
    setAuthState('authorized')
    setData(d)
    setSlug(d.item.slug)
    setTitle(d.item.title)
    setAnchorName(d.item.anchorName)
    setAnchorUrl(d.item.anchorUrl)
    setAnchorIconUrl(d.item.anchorIconUrl)
    setDescription(d.item.description)
    setStatus(d.item.status)
  }

  async function fetchAllOffers() {
    const res = await fetch('/api/admin/offers', { cache: 'no-store' })
    if (!res.ok) return
    const d = await res.json() as { items: OfferItem[] }
    setAllOffers(d.items)
  }

  useEffect(() => { fetchData(); fetchAllOffers() }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    const res = await fetch(`/api/admin/anchor-events/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, title, anchorName, anchorUrl, description, status }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json() as { error?: string }
      setSaveError(d.error ?? 'Save failed')
      return
    }
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
    // Reload from DB to confirm what was actually persisted
    await fetchData()
  }

  async function handleIconUpload(file: File) {
    setIconUploading(true)
    setIconError(null)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/admin/anchor-events/${params.id}/icon`, { method: 'POST', body: form })
    setIconUploading(false)
    if (!res.ok) {
      const d = await res.json() as { error?: string }
      setIconError(d.error ?? 'Upload failed')
      return
    }
    const d = await res.json() as { anchor_icon_url: string }
    setAnchorIconUrl(d.anchor_icon_url)
  }

  async function handleIconDelete() {
    setIconUploading(true)
    setIconError(null)
    await fetch(`/api/admin/anchor-events/${params.id}/icon`, { method: 'DELETE' })
    setIconUploading(false)
    setAnchorIconUrl('')
  }

  async function searchEvents(q: string) {
    if (!q.trim()) { setEventResults([]); return }
    setEventSearching(true)
    const res = await fetch(`/api/admin/events/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
    setEventSearching(false)
    if (!res.ok) return
    const d = await res.json() as { results?: EventItem[] }
    setEventResults(d.results ?? [])
  }

  async function addEvent(event: EventItem) {
    if (!data) return
    const alreadyLinked = data.events.some((e) => e.id === event.id)
    if (alreadyLinked) return
    const newEvents = [...data.events, event]
    const res = await fetch(`/api/admin/anchor-events/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventIds: newEvents.map((e) => e.id) }),
    })
    if (res.ok) {
      setData({ ...data, events: newEvents })
      setEventSearch('')
      setEventResults([])
    }
  }

  async function removeEvent(eventId: string) {
    if (!data) return
    const newEvents = data.events.filter((e) => e.id !== eventId)
    const res = await fetch(`/api/admin/anchor-events/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventIds: newEvents.map((e) => e.id) }),
    })
    if (res.ok) setData({ ...data, events: newEvents })
  }

  async function moveEvent(eventId: string, dir: 'up' | 'down') {
    if (!data) return
    const idx = data.events.findIndex((e) => e.id === eventId)
    if (idx < 0) return
    const newEvents = [...data.events]
    const swap = dir === 'up' ? idx - 1 : idx + 1
    if (swap < 0 || swap >= newEvents.length) return
    ;[newEvents[idx], newEvents[swap]] = [newEvents[swap], newEvents[idx]]
    await fetch(`/api/admin/anchor-events/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventIds: newEvents.map((e) => e.id) }),
    })
    setData({ ...data, events: newEvents })
  }

  async function addOffer(offer: OfferItem) {
    if (!data) return
    if (data.offers.some((o) => o.id === offer.id)) return
    const newOffers = [...data.offers, offer]
    const res = await fetch(`/api/admin/anchor-events/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerIds: newOffers.map((o) => o.id) }),
    })
    if (res.ok) setData({ ...data, offers: newOffers })
  }

  async function removeOffer(offerId: string) {
    if (!data) return
    const newOffers = data.offers.filter((o) => o.id !== offerId)
    const res = await fetch(`/api/admin/anchor-events/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerIds: newOffers.map((o) => o.id) }),
    })
    if (res.ok) setData({ ...data, offers: newOffers })
  }

  async function moveOffer(offerId: string, dir: 'up' | 'down') {
    if (!data) return
    const idx = data.offers.findIndex((o) => o.id === offerId)
    if (idx < 0) return
    const newOffers = [...data.offers]
    const swap = dir === 'up' ? idx - 1 : idx + 1
    if (swap < 0 || swap >= newOffers.length) return
    ;[newOffers[idx], newOffers[swap]] = [newOffers[swap], newOffers[idx]]
    await fetch(`/api/admin/anchor-events/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerIds: newOffers.map((o) => o.id) }),
    })
    setData({ ...data, offers: newOffers })
  }

  if (authState === 'unauthorized') return <LoginModal onClose={() => setShowLogin(false)} next={`/admin/anchor-events/${params.id}`} />

  const s: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto', padding: '32px 24px', color: '#2c2420' }
  const label: React.CSSProperties = { fontSize: 11, letterSpacing: '.07em', textTransform: 'uppercase', color: '#888', display: 'block', marginBottom: 4 }
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #d5cbc3', borderRadius: 6, fontSize: 14, boxSizing: 'border-box', background: '#fff' }
  const card: React.CSSProperties = { background: '#fdf8f4', border: '1px solid #E8DDD0', borderRadius: 12, padding: 20, marginBottom: 20 }

  const linkedOfferIds = new Set(data?.offers.map((o) => o.id) ?? [])
  const unlinkedOffers = allOffers.filter((o) => !linkedOfferIds.has(o.id) && o.status === 'active')

  return (
    <div style={s}>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <a href="/admin" style={{ color: '#6E1F2B', fontSize: 13 }}>WHISPERED EVENTS</a>
        <span style={{ color: '#aaa' }}>→</span>
        <a href="/admin/anchor-events" style={{ color: '#6E1F2B', fontSize: 13 }}>ANCHOR EVENTS</a>
        <span style={{ color: '#aaa' }}>→</span>
        <span style={{ fontSize: 13, color: '#888' }}>{data?.item.slug ?? params.id}</span>
      </div>

      <AdminTabs active="anchor-events" />

      {data === null ? (
        <div style={{ color: '#888' }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{data.item.title || data.item.slug}</h1>
            <a href={`/${data.item.slug}`} target="_blank" rel="noopener noreferrer" style={{ color: '#aaa', fontSize: 13 }}>↗ view page</a>
          </div>

          {/* Core fields */}
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: '.06em', marginBottom: 16 }}>SETTINGS</div>
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={label}>Slug (URL)</label>
                  <input style={input} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="dreamforce-26" />
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>whisperedevents.com/{slug}</div>
                </div>
                <div>
                  <label style={label}>Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'draft' | 'live')}
                    style={{ ...input, cursor: 'pointer' }}
                  >
                    <option value="draft">Draft (hidden)</option>
                    <option value="live">Live (public)</option>
                  </select>
                </div>
                <div>
                  <label style={label}>Page Title</label>
                  <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dreamforce '26 Side Events" />
                </div>
                <div>
                  <label style={label}>Anchor Name</label>
                  <input style={input} value={anchorName} onChange={(e) => setAnchorName(e.target.value)} placeholder="Dreamforce" />
                </div>
                <div>
                  <label style={label}>Anchor URL (main event site)</label>
                  <input style={input} value={anchorUrl} onChange={(e) => setAnchorUrl(e.target.value)} placeholder="https://dreamforce.com" />
                </div>
                <div>
                  <label style={label}>Anchor Icon</label>
                  {anchorIconUrl ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img src={anchorIconUrl} alt="icon" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 8, border: '1px solid #333' }} />
                      <button
                        type="button"
                        onClick={handleIconDelete}
                        disabled={iconUploading}
                        style={{ fontSize: 12, color: '#e05c5c', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        {iconUploading ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  ) : (
                    <label style={{ display: 'block', cursor: 'pointer' }}>
                      <div style={{ ...input, textAlign: 'center', color: '#888', cursor: 'pointer' }}>
                        {iconUploading ? 'Uploading…' : 'Click to upload image'}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleIconUpload(f) }}
                      />
                    </label>
                  )}
                  {iconError && <div style={{ color: '#e05c5c', fontSize: 12, marginTop: 4 }}>{iconError}</div>}
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={label}>Description / Subtitle</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  style={{ ...input, resize: 'vertical' }}
                  placeholder="The definitive guide to side events at Dreamforce '26"
                />
              </div>
              {saveError && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{saveError}</div>}
              <button
                type="submit"
                disabled={saving}
                style={{ background: saved ? '#1a6630' : '#6E1F2B', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, cursor: 'pointer' }}
              >
                {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
              </button>
            </form>
          </div>

          {/* Linked events */}
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: '.06em', marginBottom: 14 }}>
              LINKED EVENTS ({data.events.length})
            </div>

            {data.events.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                {data.events.map((ev, i) => (
                  <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F0EAE3' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button onClick={() => moveEvent(ev.id, 'up')} disabled={i === 0} style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? '#ddd' : '#888', fontSize: 12, padding: 0, lineHeight: 1 }}>▲</button>
                      <button onClick={() => moveEvent(ev.id, 'down')} disabled={i === data.events.length - 1} style={{ background: 'none', border: 'none', cursor: i === data.events.length - 1 ? 'default' : 'pointer', color: i === data.events.length - 1 ? '#ddd' : '#888', fontSize: 12, padding: 0, lineHeight: 1 }}>▼</button>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{ev.name}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>{ev.date} · {ev.location} · {ev.type}</div>
                    </div>
                    <button onClick={() => removeEvent(ev.id)} style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 13 }}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ position: 'relative' }}>
              <input
                value={eventSearch}
                onChange={(e) => { setEventSearch(e.target.value); searchEvents(e.target.value) }}
                placeholder="Search events to add…"
                style={{ ...input, marginBottom: 0 }}
              />
              {eventSearching && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Searching…</div>}
              {eventResults.length > 0 && (
                <div style={{ border: '1px solid #d5cbc3', borderRadius: 6, background: '#fff', marginTop: 4 }}>
                  {eventResults.map((ev) => (
                    <button
                      key={ev.id}
                      onClick={() => addEvent(ev)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: 'none', cursor: 'pointer', borderBottom: '1px solid #f0ede9', fontSize: 14 }}
                    >
                      <span style={{ fontWeight: 500 }}>{ev.name}</span>
                      <span style={{ color: '#888', fontSize: 12, marginLeft: 8 }}>{ev.date} · {ev.location}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Linked offers */}
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: '.06em', marginBottom: 14 }}>
              LINKED OFFERS ({data.offers.length})
            </div>

            {data.offers.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                {data.offers.map((offer, i) => (
                  <div key={offer.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F0EAE3' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button onClick={() => moveOffer(offer.id, 'up')} disabled={i === 0} style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? '#ddd' : '#888', fontSize: 12, padding: 0, lineHeight: 1 }}>▲</button>
                      <button onClick={() => moveOffer(offer.id, 'down')} disabled={i === data.offers.length - 1} style={{ background: 'none', border: 'none', cursor: i === data.offers.length - 1 ? 'default' : 'pointer', color: i === data.offers.length - 1 ? '#ddd' : '#888', fontSize: 12, padding: 0, lineHeight: 1 }}>▼</button>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{offer.name}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>{offer.ctaText}</div>
                    </div>
                    <button onClick={() => removeOffer(offer.id)} style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 13 }}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            {unlinkedOffers.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Add offer:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {unlinkedOffers.map((offer) => (
                    <button
                      key={offer.id}
                      onClick={() => addOffer(offer)}
                      style={{ background: '#f0ede9', border: '1px solid #d5cbc3', borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer' }}
                    >
                      + {offer.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {allOffers.length === 0 && (
              <div style={{ fontSize: 13, color: '#aaa' }}>
                No offers yet. <a href="/admin/offers" style={{ color: '#6E1F2B' }}>Create offers →</a>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
