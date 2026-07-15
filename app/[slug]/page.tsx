'use client'

import { useEffect, useState, useMemo } from 'react'
import { formatEventDate } from '@/lib/dates'
import type { AnchorEvent } from '@/lib/anchor-events'
import type { Offer } from '@/lib/offers'
import LoginModal from '@/components/LoginModal'
import AddEventModal from '@/components/AddEventModal'

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
  faviconUrl: string
  seniority: string[]
}

interface PageData {
  anchorEvent: AnchorEvent
  events: EventSummary[]
  offers: Offer[]
}

function OfferBanner({ offer }: { offer: Offer }) {
  const inner = (
    <img
      src={offer.bannerUrl}
      alt={offer.name}
      style={{ width: '100%', display: 'block', aspectRatio: '2 / 1', objectFit: 'cover' }}
    />
  )
  return offer.url ? (
    <a href={offer.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', borderRadius: 10, overflow: 'hidden', textDecoration: 'none' }}>
      {inner}
    </a>
  ) : (
    <div style={{ borderRadius: 10, overflow: 'hidden' }}>{inner}</div>
  )
}

// Build rotating windows of exactly `size` items (wrapping around) so
// desktop always shows a full row. With 4 offers and size=3:
//   window 0 → [0,1,2], window 1 → [3,0,1]
function offerWindows<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return []
  const perWindow = Math.min(size, arr.length)
  const numWindows = arr.length <= perWindow ? 1 : Math.ceil(arr.length / perWindow)
  return Array.from({ length: numWindows }, (_, w) =>
    Array.from({ length: perWindow }, (__, j) => arr[(w * perWindow + j) % arr.length])
  )
}

function InlineOfferSlot({ chunk, visible }: { chunk: Offer[]; visible: boolean }) {
  const [mobileIdx, setMobileIdx] = useState(0)

  // Reset mobile index when chunk changes (on global tick)
  useEffect(() => { setMobileIdx(0) }, [chunk])

  // Mobile: slide every 5s within this chunk
  useEffect(() => {
    if (chunk.length <= 1) return
    const id = setInterval(() => setMobileIdx((i) => (i + 1) % chunk.length), 5000)
    return () => clearInterval(id)
  }, [chunk.length])

  return (
    <div style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.4s ease', margin: '8px 0 4px' }}>
      {/* Desktop: up to 3 in a row */}
      <div
        className="offers-desktop"
        style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(chunk.length, 3)}, 1fr)`, gap: 14, justifyContent: 'start' }}
      >
        {chunk.map((offer) => <OfferBanner key={offer.id} offer={offer} />)}
      </div>

      {/* Mobile: fade carousel (no dots) */}
      <div className="offers-mobile" style={{ position: 'relative', paddingBottom: '50%' }}>
        {chunk.map((offer, i) => (
          <div key={offer.id} style={{ position: 'absolute', inset: 0, opacity: i === mobileIdx ? 1 : 0, transition: 'opacity 0.6s ease', pointerEvents: i === mobileIdx ? 'auto' : 'none' }}>
            <OfferBanner offer={offer} />
          </div>
        ))}
      </div>

      <style>{`
        @media (min-width: 600px) { .offers-desktop { display: grid !important; } .offers-mobile { display: none !important; } }
        @media (max-width: 599px) { .offers-desktop { display: none !important; } .offers-mobile { display: block !important; } }
      `}</style>
    </div>
  )
}

export default function AnchorEventPage({ params }: { params: { slug: string } }) {
  const [data, setData] = useState<PageData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userSeniority, setUserSeniority] = useState<string | null>(null)
  const [showAuthDialog, setShowAuthDialog] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filterType, setFilterType] = useState<string>('all')
  const [filterDay, setFilterDay] = useState<string>('all')
  const [filterTime, setFilterTime] = useState<string>('all')
  const [showFilterSheet, setShowFilterSheet] = useState(false)
  const [offerTick, setOfferTick] = useState(0)
  const [offersVisible, setOffersVisible] = useState(true)
  const [urlCopied, setUrlCopied] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authState, setAuthState] = useState<'idle' | 'loading' | 'sent'>('idle')

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
      const meData = await meRes.json() as { user: { seniority?: string | null } | null }
      setIsLoggedIn(!!meData.user)
      setUserSeniority(meData.user?.seniority ?? null)
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
      // When logged in, hide events whose seniority list doesn't include the user's seniority.
      // Events with an empty seniority array are open to everyone.
      if (isLoggedIn && userSeniority && e.seniority.length > 0 && !e.seniority.includes(userSeniority)) return false
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
  }, [data, filterType, filterDay, filterTime, isLoggedIn, userSeniority])

  const bannerOffers = useMemo(() => (data?.offers ?? []).filter((o) => o.bannerUrl), [data])
  const offerChunks = useMemo(() => offerWindows(bannerOffers, 3), [bannerOffers])

  // Cycle all inline offer slots together every 10s so each slot shows
  // a different chunk and they rotate in unison (slot0↔slot1 swap etc.)
  useEffect(() => {
    if (offerChunks.length <= 1) return
    const id = setInterval(() => {
      setOffersVisible(false)
      setTimeout(() => {
        setOfferTick((t) => t + 1)
        setOffersVisible(true)
      }, 400)
    }, 10000)
    return () => clearInterval(id)
  }, [offerChunks.length])

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
      {showLoginModal && (
        <div style={{
          '--paper': '#252220',
          '--paper-2': '#2c2825',
          '--ink': '#ece6da',
          '--ink-2': 'rgba(236,230,218,0.78)',
          '--ink-3': 'rgba(236,230,218,0.5)',
          '--rule': 'rgba(236,230,218,0.16)',
          '--accent': '#c9a86a',
          '--accent-2': '#d5b87c',
        } as React.CSSProperties}>
          <LoginModal onClose={() => setShowLoginModal(false)} />
        </div>
      )}

      {showAddEvent && (
        <AddEventModal onClose={() => setShowAddEvent(false)} />
      )}

      {/* Auth dialog */}
      {showAuthDialog && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => { setShowAuthDialog(false); setAuthState('idle'); setAuthEmail('') }}
        >
          <div
            style={{ background: '#251e19', border: '1px solid rgba(201,168,106,0.25)', borderRadius: 18, padding: '36px 32px', maxWidth: 420, width: '100%', textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            {authState === 'sent' ? (
              <>
                <div style={{ fontFamily: SERIF, fontSize: 26, color: '#ece6da', marginBottom: 10 }}>Check your email.</div>
                <div style={{ color: '#9c8b7e', fontSize: 15, lineHeight: 1.6 }}>
                  We sent a login link to <strong style={{ color: '#ece6da' }}>{authEmail}</strong>. It expires in 15 minutes.
                </div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: SERIF, fontSize: 28, color: '#ece6da', marginBottom: 10, lineHeight: 1.2 }}>See whispered events</div>
                <div style={{ color: '#9c8b7e', fontSize: 15, lineHeight: 1.65, marginBottom: 24 }}>
                  Create a free profile to see all {data?.anchorEvent.shortName || data?.anchorEvent.anchorName} events that match your level and get a personalized feed of exclusive in-person events.
                </div>

                {/* Primary CTA */}
                <a
                  href="/dashboard"
                  style={{ display: 'block', background: '#c9a86a', color: '#1b1814', textDecoration: 'none', borderRadius: 10, padding: '13px 24px', fontSize: 15, fontWeight: 600, textAlign: 'center' }}
                >
                  Create Free Profile
                </a>

                {/* Divider */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
                  <span style={{ color: '#5a4f47', fontSize: 12 }}>or</span>
                  <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' }} />
                </div>

                {/* Login path */}
                <div style={{ marginBottom: 10, color: '#c9b99a', fontSize: 14, fontWeight: 500 }}>Have a Whispered Events account?</div>
                <div style={{ color: '#6b5e53', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
                  Enter your email and we&apos;ll send a one-time login link — no password needed.
                </div>
                <input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && authEmail.trim() && authState === 'idle') {
                      setAuthState('loading')
                      await fetch('/api/auth/magic-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authEmail.trim() }) })
                      setAuthState('sent')
                    }
                  }}
                  placeholder="you@company.com"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#ece6da', outline: 'none', boxSizing: 'border-box' }}
                />
                <button
                  disabled={authState === 'loading' || !authEmail.trim()}
                  onClick={async () => {
                    if (!authEmail.trim()) return
                    setAuthState('loading')
                    await fetch('/api/auth/magic-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authEmail.trim() }) })
                    setAuthState('sent')
                  }}
                  style={{ marginTop: 10, width: '100%', background: 'rgba(201,168,106,0.15)', border: '1px solid rgba(201,168,106,0.35)', borderRadius: 8, padding: '10px 14px', fontSize: 14, color: '#c9a86a', cursor: authState === 'loading' || !authEmail.trim() ? 'default' : 'pointer', opacity: authEmail.trim() ? 1 : 0.45 }}
                >
                  {authState === 'loading' ? 'Sending…' : 'Send login link →'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mobile-responsive styles */}
      <style>{`
        .aep-outer { max-width: 860px; margin: 0 auto; padding: 48px 24px 80px; }
        .aep-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 32px; }
        .aep-header-left { display: flex; align-items: flex-start; gap: 24px; }
        .aep-icon { width: 120px; height: 120px; border-radius: 18px; object-fit: contain; flex-shrink: 0; }
        .aep-title { font-size: 42px; }
        .aep-desc { font-size: 18px; }
        .aep-header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .aep-filters { display: flex; gap: 8px; flex-wrap: wrap; }
        .aep-filter-select { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer; outline: none; }
        .aep-filter-btn-mobile { display: none !important; }
        .aep-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px 24px; }
        .aep-btn-text { display: inline; }
        .aep-copy-btn { display: inline-flex; }
        .aep-auth-btn-header { display: inline-flex; }
        .aep-auth-btn-filter { display: none !important; }
        .aep-card-inner { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
        .aep-card-left { flex: 1; min-width: 0; }
        .aep-card-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .aep-favicon-mobile { display: none !important; }
        .aep-desc-desktop { display: inline !important; }
        .aep-card-bottom-mobile { display: none !important; }
        @media (max-width: 600px) {
          .aep-outer { padding: 24px 16px 60px; }
          .aep-header { flex-direction: column; gap: 12px; margin-bottom: 20px; }
          .aep-header-left { gap: 14px; }
          .aep-icon { width: 64px; height: 64px; border-radius: 12px; }
          .aep-title { font-size: 26px !important; }
          .aep-desc { font-size: 15px !important; }
          .aep-header-actions { align-self: flex-start; }
          .aep-filters-desktop { display: none !important; }
          .aep-filter-btn-mobile { display: inline-flex !important; }
          .aep-filter-select { width: 100%; font-size: 15px; padding: 10px 12px; }
          .aep-card { padding: 14px 16px; }
          .aep-btn-text { display: none; }
          .aep-copy-btn { display: none !important; }
          .aep-auth-btn-header { display: none !important; }
          .aep-auth-btn-filter { display: inline-flex !important; }
          .aep-card-inner { flex-direction: column; gap: 0; }
          .aep-card-right { display: none !important; }
          .aep-favicon-mobile { display: inline-block !important; }
          .aep-desc-desktop { display: none !important; }
          .aep-card-bottom-mobile { display: flex !important; justify-content: space-between; align-items: center; margin-top: 10px; }
        }
      `}</style>

      {/* Page content */}
      <div className="aep-outer">

        {/* Header */}
        <div className="aep-header">
          <div className="aep-header-left">
            {anchorEvent.anchorIconUrl && (
              anchorEvent.anchorUrl ? (
                <a href={anchorEvent.anchorUrl} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, display: 'block' }}>
                  <img src={anchorEvent.anchorIconUrl} alt={anchorEvent.anchorName} className="aep-icon" />
                </a>
              ) : (
                <img src={anchorEvent.anchorIconUrl} alt={anchorEvent.anchorName} className="aep-icon" />
              )
            )}
            <div>
              <h1 className="aep-title" style={{ fontFamily: SERIF, fontWeight: 400, margin: '0 0 4px', color: '#ece6da', lineHeight: 1.15 }}>
                {anchorEvent.title || `${anchorEvent.anchorName} Side Events`}
              </h1>
              {anchorEvent.anchorName && anchorEvent.anchorUrl && (
                <a
                  href={anchorEvent.anchorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#c9a86a', fontSize: 14, textDecoration: 'none', display: 'block', marginBottom: 10 }}
                >
                  {anchorEvent.anchorName} ↗
                </a>
              )}
              {anchorEvent.description && (
                <p className="aep-desc" style={{ fontFamily: SERIF, color: '#9c8b7e', lineHeight: 1.55, margin: 0, fontWeight: 400 }}>
                  {anchorEvent.description}
                </p>
              )}
            </div>
          </div>
          <div className="aep-header-actions">
            <button
              className="aep-copy-btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href)
                  setUrlCopied(true)
                  setTimeout(() => setUrlCopied(false), 1800)
                } catch { /* blocked in insecure contexts */ }
              }}
              aria-label="Copy page link"
              title={urlCopied ? 'Copied!' : 'Copy link'}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 99, padding: '7px 10px', color: urlCopied ? '#c9a86a' : 'rgba(236,230,218,0.6)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
            >
              {urlCopied ? (
                <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden><polyline points="2,7 5.5,10.5 12,4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M2 9V3a1 1 0 0 1 1-1h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
                </svg>
              )}
            </button>
            <span className="aep-auth-btn-header">
              {isLoggedIn ? (
                <button
                  onClick={async () => {
                    await fetch('/api/auth/logout', { method: 'POST' })
                    setIsLoggedIn(false)
                  }}
                  aria-label="Log out"
                  title="Log out"
                  style={{ background: 'none', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 99, padding: '7px 10px', color: 'rgba(236,230,218,0.6)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M5 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="aep-btn-text">Log out</span>
                </button>
              ) : (
                <button
                  onClick={() => setShowLoginModal(true)}
                  aria-label="Log in"
                  title="Log in"
                  style={{ background: 'rgba(201,168,106,0.12)', border: '1px solid rgba(201,168,106,0.35)', borderRadius: 99, padding: '7px 10px', color: '#c9a86a', fontSize: 13, cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M9 2h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M5 10l-3-3 3-3M2 7h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="aep-btn-text">Log in</span>
                </button>
              )}
            </span>
          </div>
        </div>

        {/* Events */}
        {data.events.length > 0 && (
          <div style={{ marginBottom: 64 }}>
            {/* Filters */}
            {/* Filter bar */}
            {(() => {
              const activeCount = [filterDay, filterTime, filterType].filter(v => v !== 'all').length
              const filterSelects = (
                <>
                  <select value={filterDay} onChange={(e) => setFilterDay(e.target.value)} className="aep-filter-select" style={{ color: filterDay === 'all' ? '#6b5e53' : '#ece6da' }}>
                    <option value="all">All days</option>
                    {uniqueDays.map((d) => <option key={d} value={d}>{formatEventDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</option>)}
                  </select>
                  <select value={filterTime} onChange={(e) => setFilterTime(e.target.value)} className="aep-filter-select" style={{ color: filterTime === 'all' ? '#6b5e53' : '#ece6da' }}>
                    <option value="all">All times</option>
                    <option value="morning">Morning</option>
                    <option value="midday">Midday</option>
                    <option value="afternoon">Afternoon</option>
                    <option value="evening">Evening</option>
                  </select>
                  <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="aep-filter-select" style={{ color: filterType === 'all' ? '#6b5e53' : '#ece6da' }}>
                    <option value="all">All types</option>
                    {uniqueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </>
              )
              return (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                    <button onClick={() => setShowAddEvent(true)} style={{ background: 'rgba(201,168,106,0.12)', border: '1px solid rgba(201,168,106,0.35)', borderRadius: 8, padding: '6px 14px', color: '#c9a86a', fontSize: 13, cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      + Add Event
                    </button>
                    {/* Mobile: filter + auth on same row */}
                    <div className="aep-filter-btn-mobile" style={{ display: 'none', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => setShowFilterSheet(true)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '7px 14px', color: '#ece6da', fontSize: 13, cursor: 'pointer' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><line x1="1" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><line x1="1" y1="10" x2="13" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="4" cy="4" r="1.5" fill="currentColor"/><circle cx="10" cy="10" r="1.5" fill="currentColor"/></svg>
                        Filter
                        {activeCount > 0 && (
                          <span style={{ background: '#c9a86a', color: '#1a1410', borderRadius: 99, fontSize: 10, fontWeight: 700, padding: '1px 5px', lineHeight: 1.4 }}>{activeCount}</span>
                        )}
                      </button>
                      <span className="aep-auth-btn-filter">
                        {isLoggedIn ? (
                          <button
                            onClick={async () => {
                              await fetch('/api/auth/logout', { method: 'POST' })
                              setIsLoggedIn(false)
                            }}
                            aria-label="Log out"
                            title="Log out"
                            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 99, padding: '7px 10px', color: 'rgba(236,230,218,0.6)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M5 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            Log out
                          </button>
                        ) : (
                          <button
                            onClick={() => setShowLoginModal(true)}
                            aria-label="Log in"
                            title="Log in"
                            style={{ background: 'rgba(201,168,106,0.12)', border: '1px solid rgba(201,168,106,0.35)', borderRadius: 99, padding: '7px 14px', color: '#c9a86a', fontSize: 13, cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M9 2h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M5 10l-3-3 3-3M2 7h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            Log in
                          </button>
                        )}
                      </span>
                    </div>
                  </div>
                  {/* Desktop filters inline */}
                  <div className="aep-filters aep-filters-desktop">{filterSelects}</div>

                  {/* Mobile filter bottom sheet */}
                  {showFilterSheet && (
                    <div
                      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
                      onClick={(e) => { if (e.target === e.currentTarget) setShowFilterSheet(false) }}
                    >
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
                      <div style={{ position: 'relative', background: '#1e1a16', borderRadius: '16px 16px 0 0', padding: '20px 20px 40px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 15, fontWeight: 600, color: '#ece6da' }}>Filter events</span>
                          <button onClick={() => setShowFilterSheet(false)} style={{ background: 'none', border: 'none', color: '#6b5e53', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {filterSelects}
                        </div>
                        {activeCount > 0 && (
                          <button onClick={() => { setFilterDay('all'); setFilterTime('all'); setFilterType('all') }} style={{ marginTop: 4, background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '8px', color: '#6b5e53', fontSize: 13, cursor: 'pointer' }}>
                            Clear filters
                          </button>
                        )}
                        <button onClick={() => setShowFilterSheet(false)} style={{ background: 'rgba(201,168,106,0.15)', border: '1px solid rgba(201,168,106,0.35)', borderRadius: 8, padding: '10px', color: '#c9a86a', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(() => {
                // Inject offers after rows 3, 8, 13, 18… (0-indexed: 2, 7, 12, 17…).
                // If we fall 1–2 events short of a threshold, show after the last event instead.
                const slotAfter = new Set<number>()
                const last = filteredEvents.length - 1
                for (let t = 2; ; t += 5) {
                  if (t < filteredEvents.length) {
                    slotAfter.add(t)
                  } else {
                    if (last >= 0 && t - last <= 2) slotAfter.add(last)
                    break
                  }
                }

                let slotCount = 0
                return filteredEvents.flatMap((ev, i) => {
                  const expanded = expandedIds.has(ev.id)
                  const viewEventEl = ev.link ? (
                    isLoggedIn ? (
                      <a href={ev.link} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(201,168,106,0.12)', color: '#c9a86a', border: '1px solid rgba(201,168,106,0.3)', borderRadius: 8, padding: '8px 14px', fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        View event ↗
                      </a>
                    ) : (
                      <button onClick={() => setShowAuthDialog(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.04)', color: '#6b5e53', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        View event →
                      </button>
                    )
                  ) : null

                  const descToggleEl = ev.description ? (
                    <button onClick={() => toggleDescription(ev.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#c9a86a', fontSize: 13 }}>
                      {expanded ? '▲ Description' : '▼ Description'}
                    </button>
                  ) : null

                  const eventCard = (
                    <div key={ev.id} className="aep-card">
                      <div className="aep-card-inner">
                        {/* Left / main content */}
                        <div className="aep-card-left">
                          {/* Title row: inline flow so type+favicon follow name without forced line break */}
                          <div style={{ marginBottom: 5, lineHeight: 1.3 }}>
                            <span style={{ fontFamily: SERIF, fontSize: 21, color: '#ece6da' }}>{ev.name}</span>
                            {ev.type && (
                              <span style={{ display: 'inline-block', background: 'rgba(255,255,255,0.06)', borderRadius: 4, padding: '2px 7px', fontSize: 11, letterSpacing: '.04em', color: '#7a6e66', marginLeft: 8, verticalAlign: 'middle' }}>{ev.type}</span>
                            )}
                            {ev.faviconUrl && (
                              <img className="aep-favicon-mobile" src={ev.faviconUrl} alt="" style={{ display: 'inline-block', height: 20, width: 20, objectFit: 'cover', borderRadius: 4, marginLeft: 6, verticalAlign: 'middle' }} />
                            )}
                          </div>
                          {/* Meta row */}
                          <div style={{ fontSize: 13, color: '#9c8b7e', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                            {ev.date && <span>{formatEventDate(ev.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>}
                            {ev.startTime && <span style={{ color: '#c9a86a', fontWeight: 500 }}>{ev.startTime}{ev.endTime ? ` – ${ev.endTime}` : ''}</span>}
                            {ev.organizer && <span>Host: {ev.organizer}</span>}
                            {/* Description toggle — desktop only */}
                            <span className="aep-desc-desktop">{descToggleEl}</span>
                          </div>
                          {expanded && ev.description && (
                            <div style={{ fontSize: 14, color: '#7a6e66', lineHeight: 1.6, marginTop: 8 }}>{ev.description}</div>
                          )}
                          {/* Bottom row — mobile only: desc toggle left, view event right */}
                          <div className="aep-card-bottom-mobile">
                            <span>{descToggleEl}</span>
                            {viewEventEl}
                          </div>
                        </div>
                        {/* Right column — desktop only: favicon + view event */}
                        <div className="aep-card-right">
                          {ev.faviconUrl && (
                            <img src={ev.faviconUrl} alt="" style={{ height: 36, width: 36, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
                          )}
                          {viewEventEl}
                        </div>
                      </div>
                    </div>
                  )

                  const items: React.ReactNode[] = [eventCard]

                  if (slotAfter.has(i) && offerChunks.length > 0) {
                    const si = slotCount++
                    const chunk = offerChunks[(si + offerTick) % offerChunks.length]
                    items.push(
                      <InlineOfferSlot key={`offers-${i}`} chunk={chunk} visible={offersVisible} />
                    )
                  }

                  return items
                })
              })()}
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
