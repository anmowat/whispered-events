'use client'

import { useEffect, useState, useMemo } from 'react'
import { formatEventDate } from '@/lib/dates'
import type { AnchorEvent } from '@/lib/anchor-events'
import type { Offer } from '@/lib/offers'

const SERIF = `'Cormorant Garamond', Georgia, 'Times New Roman', serif`

interface EventSummary {
  id: string
  name: string
  date: string
  description: string
  link: string
  type: string
  organizer: string | null
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
  const [showShareDialog, setShowShareDialog] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filterType, setFilterType] = useState<string>('all')
  const [filterDay, setFilterDay] = useState<string>('all')

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
      return true
    })
  }, [data, filterType, filterDay])

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

  const pageUrl = typeof window !== 'undefined' ? window.location.href : ''

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
              Create free profile →
            </a>
            <button
              onClick={() => setShowAuthDialog(false)}
              style={{ background: 'none', border: 'none', color: '#6b5e53', fontSize: 14, cursor: 'pointer', marginTop: 4 }}
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      {/* Share dialog */}
      {showShareDialog && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setShowShareDialog(false)}
        >
          <div
            style={{ background: '#251e19', border: '1px solid rgba(201,168,106,0.25)', borderRadius: 16, padding: 36, maxWidth: 420, width: '100%', textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontFamily: SERIF, fontSize: 26, color: '#ece6da', marginBottom: 10 }}>Share this page</div>
            <div style={{ color: '#9c8b7e', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              Know someone planning their conference schedule? Share this page with them.
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                readOnly
                value={pageUrl}
                style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '10px 12px', color: '#ece6da', fontSize: 13, outline: 'none' }}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                onClick={() => { navigator.clipboard.writeText(pageUrl).catch(() => null) }}
                style={{ background: '#c9a86a', border: 'none', borderRadius: 8, padding: '10px 16px', color: '#1b1814', fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Copy
              </button>
            </div>
            <button
              onClick={() => setShowShareDialog(false)}
              style={{ background: 'none', border: 'none', color: '#6b5e53', fontSize: 14, cursor: 'pointer' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Page content */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 8 }}>
          <a
            href="/"
            style={{ color: '#6b5e53', fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', textDecoration: 'none' }}
          >
            Whispered Events
          </a>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 12 }}>
          {anchorEvent.anchorIconUrl && (
            <img
              src={anchorEvent.anchorIconUrl}
              alt={anchorEvent.anchorName}
              style={{ width: 52, height: 52, objectFit: 'contain', borderRadius: 10, flexShrink: 0, marginTop: 4 }}
            />
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
          <p style={{ color: '#9c8b7e', fontSize: 16, lineHeight: 1.65, marginBottom: 32, maxWidth: 640, margin: '0 0 32px' }}>
            {anchorEvent.description}
          </p>
        )}

        {/* CTAs */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 48 }}>
          {!isLoggedIn && (
            <button
              onClick={() => setShowAuthDialog(true)}
              style={{ background: '#c9a86a', color: '#1b1814', border: 'none', borderRadius: 99, padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Create free profile →
            </button>
          )}
          <button
            onClick={() => setShowShareDialog(true)}
            style={{ background: 'rgba(255,255,255,0.06)', color: '#ece6da', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 99, padding: '10px 22px', fontSize: 14, cursor: 'pointer' }}
          >
            Share page
          </button>
        </div>

        {/* Events */}
        {filteredEvents.length > 0 || uniqueTypes.length > 0 ? (
          <div style={{ marginBottom: 64 }}>
            {/* Header + filters */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: '#6b5e53' }}>
                Side Events ({filteredEvents.length}{filteredEvents.length !== data.events.length ? ` of ${data.events.length}` : ''})
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
                {uniqueDays.length > 1 && (
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
                )}
                {uniqueTypes.length > 1 && (
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
                )}
              </div>
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
                        <div style={{ fontFamily: SERIF, fontSize: 21, color: '#ece6da', marginBottom: 6, lineHeight: 1.2 }}>{ev.name}</div>
                        <div style={{ fontSize: 13, color: '#9c8b7e', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                          {ev.date && (
                            <span>{formatEventDate(ev.date, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                          )}
                          {ev.organizer && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{ opacity: 0.35 }}>·</span>
                              <span>Host: {ev.organizer}</span>
                            </span>
                          )}
                          {ev.type && (
                            <span style={{ display: 'inline-block', background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 7px', fontSize: 11, letterSpacing: '.04em', color: '#7a6e66' }}>{ev.type}</span>
                          )}
                        </div>
                        {ev.description && (
                          <button
                            onClick={() => toggleDescription(ev.id)}
                            style={{ background: 'none', border: 'none', padding: 0, marginTop: 10, cursor: 'pointer', color: '#c9a86a', fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}
                          >
                            {expanded ? '▲ Hide details' : '▼ Show details'}
                          </button>
                        )}
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
        ) : null}

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
        <div style={{ marginTop: 80, paddingTop: 32, borderTop: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
          <a href="/" style={{ color: '#6b5e53', fontSize: 13, textDecoration: 'none' }}>
            Whispered Events — private dinners &amp; side events for B2B professionals
          </a>
        </div>
      </div>
    </div>
  )
}
