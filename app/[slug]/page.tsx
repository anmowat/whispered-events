'use client'

import { useEffect, useState, useMemo } from 'react'
import { formatEventDate } from '@/lib/dates'
import type { AnchorEvent } from '@/lib/anchor-events'
import type { Offer } from '@/lib/offers'

const SERIF = `'Cormorant Garamond', Georgia, 'Times New Roman', serif`

function timeToMinutes(t: string | null): number | null {
  if (!t) return null
  const m12 = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (m12) {
    let h = parseInt(m12[1])
    const min = parseInt(m12[2])
    const ampm = m12[3].toUpperCase()
    if (ampm === 'AM' && h === 12) h = 0
    if (ampm === 'PM' && h !== 12) h += 12
    return h * 60 + min
  }
  const m24 = t.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) return parseInt(m24[1]) * 60 + parseInt(m24[2])
  return null
}

interface EventSummary {
  id: string
  name: string
  date: string
  description: string
  link: string
  type: string
  organizer: string | null
  startTime: string | null
  endTime: string | null
  featured: boolean
}

interface PageData {
  anchorEvent: AnchorEvent
  events: EventSummary[]
  offers: Offer[]
}

export default function AnchorEventPage({ params }: { params: { slug: string } }) {
  const [data, setData] = useState<PageData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [showAuthDialog, setShowAuthDialog] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filterType, setFilterType] = useState<string>('all')
  const [filterDay, setFilterDay] = useState<string>('all')
  const [filterTime, setFilterTime] = useState<string>('all')

  useEffect(() => {
    async function load() {
      const [pageRes, meRes] = await Promise.all([
        fetch(`/api/anchor-events/${params.slug}`, { cache: 'no-store' }),
        fetch('/api/auth/me'),
      ])
      if (!pageRes.ok) {
        setNotFound(true)
        return
      }
      const pageData = await pageRes.json() as PageData
      setData(pageData)
      const meData = await meRes.json() as { user: unknown }
      setIsLoggedIn(!!meData.user)
    }
    load()
  }, [params.slug])

  const uniqueTypes = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(data.events.map((e) => e.type).filter(Boolean))).sort()
  }, [data])

  const uniqueDays = useMemo(() => {
    if (!data) return []
    const days = Array.from(new Set(data.events.map((e) => e.date).filter(Boolean))).sort()
    return days
  }, [data])

  const filteredEvents = useMemo(() => {
    if (!data) return []
    return data.events.filter((e) => {
      if (filterType !== 'all' && e.type !== filterType) return false
      if (filterDay !== 'all' && e.date !== filterDay) return false
      if (filterTime !== 'all') {
        const mins = timeToMinutes(e.startTime)
        if (mins === null) return false
        if (filterTime === 'morning' && !(mins >= 7 * 60 && mins < 12 * 60)) return false
        if (filterTime === 'midday' && !(mins >= 10 * 60 + 30 && mins <= 14 * 60)) return false
        if (filterTime === 'afternoon' && !(mins >= 13 * 60 && mins <= 17 * 60)) return false
        if (filterTime === 'evening' && !(mins >= 16 * 60)) return false
      }
      return true
    })
  }, [data, filterType, filterDay, filterTime])

  function toggleDescription(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', background: '#1b1814', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ color: '#6b5e53', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>404</div>
          <div style={{ color: '#9c8b7e' }}>Page not found</div>

          <a href="/" style={{ display: 'inline-block', marginTop: 20, color: '#c9a86a', fontSize: 14 }}>← Back to Whispered Events</a>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ minHeight: '100vh', background: '#1b1814', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#6b5e53', fontFamily: 'system-ui, sans-serif', fontSize: 14 }}>Loading…</div>
      </div>
    )
  }

  const { anchorEvent, offers } = data

  return (
    <div style={{ minHeight: '100vh', background: '#1b1814', color: '#ece6da', fontFamily: 'system-ui, sans-serif' }}>
      {/* Auth dialog */}
      {showAuthDialog && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowAuthDialog(false)}
        >
          <div
            style={{ background: '#251e19', border: '1px solid rgba(201,168,106,0.25)', borderRadius: 16, padding: 36, maxWidth: 400, width: '100%', textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontFamily: SERIF, fontSize: 26, color: '#ece6da', marginBottom: 10 }}>See all side events</div>
            <div style={{ color: '#9c8b7e', fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
              Create your free profile to see event details and get a personalized feed of side event matches.
            </div>
            <a
              href="/dashboard"
              style={{ display: 'block', background: '#c9a86a', color: '#1b1814', textDecoration: 'none', borderRadius: 10, padding: '13px 24px', fontSize: 15, fontWeight: 600, marginBottom: 10 }}
            >
              Create Free Profile →
            </a>
            <a
              href="/?login=1"
              style={{ display: 'block', color: '#9c8b7e', fontSize: 14, textDecoration: 'none', marginTop: 4 }}
            >
              Have a Whispered Events account? Log in →
            </a>
          </div>
        </div>
      )}

      {/* Page content */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 12 }}>
          {anchorEvent.anchorIconUrl && (
            anchorEvent.anchorUrl ? (
              <a href={anchorEvent.anchorUrl} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, display: 'block' }}>
                <img
                  src={anchorEvent.anchorIconUrl}
                  alt={anchorEvent.anchorName}
                  style={{ width: 88, height: 88, objectFit: 'contain', borderRadius: 14 }}
                />
              </a>
            ) : (
              <img
                src={anchorEvent.anchorIconUrl}
                alt={anchorEvent.anchorName}
                style={{ width: 88, height: 88, objectFit: 'contain', borderRadius: 14, flexShrink: 0 }}
              />
            )
          )}
          <div>
            <h1 style={{ fontFamily: SERIF, fontSize: 42, fontWeight: 400, margin: '0 0 6px', color: '#ece6da', lineHeight: 1.15 }}>
              {anchorEvent.title || `${anchorEvent.anchorName} Side Events`}
            </h1>
            {anchorEvent.anchorName && anchorEvent.anchorUrl && (
              <a
                href={anchorEvent.anchorUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#c9a86a', fontSize: 14, textDecoration: 'none' }}
              >
                {anchorEvent.anchorName} ↗
              </a>
            )}
          </div>
        </div>

        {anchorEvent.description && (
          <p style={{ color: '#9c8b7e', fontSize: 16, lineHeight: 1.65, maxWidth: 640, margin: '0 0 32px' }}>
            {anchorEvent.description}
          </p>
        )}

        {/* CTA */}
        {!isLoggedIn && (
          <div style={{ marginBottom: 40 }}>
            <button
              onClick={() => setShowAuthDialog(true)}
              style={{ background: '#c9a86a', color: '#1b1814', border: 'none', borderRadius: 99, padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Create Free Profile →
            </button>
          </div>
        )}

        {/* Events */}
        {data.events.length > 0 && (
          <div style={{ marginBottom: 64 }}>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20, justifyContent: 'flex-end' }}>
              <select
                value={filterDay}
                onChange={(e) => setFilterDay(e.target.value)}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 10px', color: filterDay === 'all' ? '#6b5e53' : '#ece6da', fontSize: 13, cursor: 'pointer', outline: 'none' }}
              >
                <option value="all">All days</option>
                {uniqueDays.map((d) => (
                  <option key={d} value={d}>{formatEventDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</option>
                ))}
              </select>
              <select
                value={filterTime}
                onChange={(e) => setFilterTime(e.target.value)}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 10px', color: filterTime === 'all' ? '#6b5e53' : '#ece6da', fontSize: 13, cursor: 'pointer', outline: 'none' }}
              >
                <option value="all">All times</option>
                <option value="morning">Morning</option>
                <option value="midday">Midday</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </select>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 10px', color: filterType === 'all' ? '#6b5e53' : '#ece6da', fontSize: 13, cursor: 'pointer', outline: 'none' }}
              >
                <option value="all">All types</option>
                {uniqueTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filteredEvents.map((ev) => {
                const expanded = expandedIds.has(ev.id)
                return (
                  <div
                    key={ev.id}
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 24px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 5 }}>
                          <div style={{ fontFamily: SERIF, fontSize: 21, color: '#ece6da', lineHeight: 1.2 }}>{ev.name}</div>
                          {ev.type && (
                            <span style={{ display: 'inline-block', background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 7px', fontSize: 11, letterSpacing: '.04em', color: '#7a6e66', flexShrink: 0 }}>{ev.type}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: '#9c8b7e', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                          {ev.date && (
                            <span>{formatEventDate(ev.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                          )}
                          {ev.startTime && (
                            <span style={{ color: '#c9a86a', fontWeight: 500 }}>{ev.startTime}{ev.endTime ? ` – ${ev.endTime}` : ''}</span>
                          )}
                          {ev.organizer && (
                            <span>Host: {ev.organizer}</span>
                          )}
                          {ev.description && (
                            <button
                              onClick={() => toggleDescription(ev.id)}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#c9a86a', fontSize: 13 }}
                            >
                              {expanded ? '▲ Description' : '▼ Description'}
                            </button>
                          )}
                        </div>
                        {expanded && ev.description && (
                          <div style={{ fontSize: 14, color: '#7a6e66', lineHeight: 1.6, marginTop: 8 }}>{ev.description}</div>
                        )}
                      </div>
                      {ev.link && (
                        isLoggedIn ? (
                          <a
                            href={ev.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(201,168,106,0.12)', color: '#c9a86a', border: '1px solid rgba(201,168,106,0.3)', borderRadius: 8, padding: '8px 14px', fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            View event ↗
                          </a>
                        ) : (
                          <button
                            onClick={() => setShowAuthDialog(true)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.04)', color: '#6b5e53', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            View event →
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Offers */}
        {offers.length > 0 && (
          <div>
            <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: '#6b5e53', marginBottom: 20 }}>
              Partners & Offers
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {offers.map((offer) => (
                <div
                  key={offer.id}
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}
                >
                  {offer.bannerUrl && (
                    <img
                      src={offer.bannerUrl}
                      alt={offer.name}
                      style={{ width: '100%', display: 'block', maxHeight: 200, objectFit: 'cover' }}
                    />
                  )}
                  <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      {offer.logoUrl && (
                        <img
                          src={offer.logoUrl}
                          alt={offer.name}
                          style={{ height: 36, objectFit: 'contain', flexShrink: 0 }}
                        />
                      )}
                      <div style={{ fontFamily: SERIF, fontSize: 19, color: '#ece6da' }}>{offer.name}</div>
                    </div>
                    {offer.ctaText && offer.url && (
                      <a
                        href={offer.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'inline-block', background: '#c9a86a', color: '#1b1814', textDecoration: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}
                      >
                        {offer.ctaText}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 64, paddingBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(236,230,218,.13)' }} />
            <svg width="48" height="48" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <line x1="18" y1="82" x2="82" y2="18" stroke="#C9A86A" strokeWidth="5" strokeLinecap="round"/>
              <ellipse cx="42" cy="58" rx="17" ry="12" transform="rotate(-45 42 58)" fill="#C9A86A"/>
              <ellipse cx="42" cy="58" rx="5" ry="3.5" transform="rotate(-45 42 58)" fill="#1b1814"/>
            </svg>
            <div style={{ flex: 1, height: 1, background: 'rgba(236,230,218,.13)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 15, color: 'rgba(236,230,218,.5)', letterSpacing: '.03em' }}>Whispered © 2026</span>
            <a href="/faq" style={{ fontSize: 15, color: 'rgba(236,230,218,.5)', letterSpacing: '.06em', textDecoration: 'none' }}>FAQ</a>
          </div>
        </div>

      </div>
    </div>
  )
}
