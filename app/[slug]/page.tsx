'use client'

import { useEffect, useState, useMemo } from 'react'
import { formatEventDate } from '@/lib/dates'
import type { AnchorEvent } from '@/lib/anchor-events'
import type { Offer } from '@/lib/offers'
import LoginModal from '@/components/LoginModal'

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

function OffersSection({ offers }: { offers: Offer[] }) {
  const PAGE = 3
  const desktopPages = Math.ceil(offers.length / PAGE)
  const [desktopPage, setDesktopPage] = useState(0)
  const [desktopVisible, setDesktopVisible] = useState(true)
  const [mobileIdx, setMobileIdx] = useState(0)

  // Desktop: fade out → swap → fade in every 10s (only if more than one page)
  useEffect(() => {
    if (desktopPages <= 1) return
    const id = setInterval(() => {
      setDesktopVisible(false)
      setTimeout(() => {
        setDesktopPage((p) => (p + 1) % desktopPages)
        setDesktopVisible(true)
      }, 400)
    }, 10000)
    return () => clearInterval(id)
  }, [desktopPages])

  // Mobile: slide every 5s
  useEffect(() => {
    if (offers.length <= 1) return
    const id = setInterval(() => setMobileIdx((i) => (i + 1) % offers.length), 5000)
    return () => clearInterval(id)
  }, [offers.length])

  const desktopSlice = offers.slice(desktopPage * PAGE, desktopPage * PAGE + PAGE)

  return (
    <div>
      <div style={{ fontSize: 13, letterSpacing: '.04em', color: '#6b5e53', marginBottom: 16, fontStyle: 'italic' }}>
        Brought to you by:
      </div>

      {/* Desktop: 3 at a time, fade between groups */}
      <div
        className="offers-desktop"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          opacity: desktopVisible ? 1 : 0,
          transition: 'opacity 0.4s ease',
        }}
      >
        {desktopSlice.map((offer) => <OfferBanner key={offer.id} offer={offer} />)}
      </div>

      {/* Mobile: single slide carousel */}
      <div className="offers-mobile" style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            transition: 'transform 0.5s ease',
            transform: `translateX(-${mobileIdx * 100}%)`,
          }}
        >
          {offers.map((offer) => (
            <div key={offer.id} style={{ minWidth: '100%' }}>
              <OfferBanner offer={offer} />
            </div>
          ))}
        </div>
        {offers.length > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 10 }}>
            {offers.map((_, i) => (
              <button
                key={i}
                onClick={() => setMobileIdx(i)}
                style={{
                  width: 6, height: 6, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
                  background: i === mobileIdx ? '#c9a86a' : 'rgba(201,168,106,0.3)',
                  transition: 'background 0.3s',
                }}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @media (min-width: 600px) {
          .offers-desktop { display: grid !important; }
          .offers-mobile { display: none !important; }
        }
        @media (max-width: 599px) {
          .offers-desktop { display: none !important; }
          .offers-mobile { display: block !important; }
        }
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filterType, setFilterType] = useState<string>('all')
  const [filterDay, setFilterDay] = useState<string>('all')
  const [filterTime, setFilterTime] = useState<string>('all')
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

      {/* Page content */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
            {anchorEvent.anchorIconUrl && (
              anchorEvent.anchorUrl ? (
                <a href={anchorEvent.anchorUrl} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, display: 'block' }}>
                  <img
                    src={anchorEvent.anchorIconUrl}
                    alt={anchorEvent.anchorName}
                    style={{ width: 120, height: 120, objectFit: 'contain', borderRadius: 18 }}
                  />
                </a>
              ) : (
                <img
                  src={anchorEvent.anchorIconUrl}
                  alt={anchorEvent.anchorName}
                  style={{ width: 120, height: 120, objectFit: 'contain', borderRadius: 18, flexShrink: 0 }}
                />
              )
            )}
            <div>
              <h1 style={{ fontFamily: SERIF, fontSize: 42, fontWeight: 400, margin: '0 0 4px', color: '#ece6da', lineHeight: 1.15 }}>
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
                <p style={{ fontFamily: SERIF, color: '#9c8b7e', fontSize: 18, lineHeight: 1.55, margin: 0, fontWeight: 400 }}>
                  {anchorEvent.description}
                </p>
              )}
            </div>
          </div>
          {isLoggedIn ? (
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' })
                setIsLoggedIn(false)
              }}
              style={{ flexShrink: 0, background: 'none', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 99, padding: '7px 16px', color: 'rgba(236,230,218,0.6)', fontSize: 13, cursor: 'pointer' }}
            >
              Log out
            </button>
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              style={{ flexShrink: 0, background: 'rgba(201,168,106,0.12)', border: '1px solid rgba(201,168,106,0.35)', borderRadius: 99, padding: '7px 16px', color: '#c9a86a', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
            >
              Log in
            </button>
          )}
        </div>

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
        {offers.filter((o) => o.bannerUrl).length > 0 && (
          <OffersSection offers={offers.filter((o) => o.bannerUrl)} />
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
