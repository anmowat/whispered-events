'use client'

import { useEffect, useRef, useState } from 'react'
import { HeaderTab } from '@/components/Header'
import ShareEventTab from '@/components/ShareEventTab'
import PartnerApplyTab from '@/components/PartnerApplyTab'
import ViewEventsTab from '@/components/ViewEventsTab'
import LoginModal from '@/components/LoginModal'
import PartnerMarquee from '@/components/PartnerMarquee'
import { Partner, FeaturedEvent } from '@/lib/airtable'
import { formatEventDate } from '@/lib/dates'

type Mode = 'landing' | 'active'

// "After Hours" homepage. Warm near-black background, champagne accent.
// The Header / right-slot / chat state machine carries forward — only
// the visual chrome is new. Body gets the `theme-after-hours` class so
// the chat surfaces (ViewEventsTab / ShareEventTab / PartnerApplyTab),
// LoginModal, PartnerMarquee, etc. re-theme via CSS-var overrides
// defined in globals.css.

const SERIF = `'Cormorant Garamond', Georgia, 'Times New Roman', serif`

// Champagne line-icons for the hero "how it works" steps. currentColor
// so the wrapping span's color (champagne) flows through. 24×24, 1.4px
// stroke — sized to read at body weight alongside short text labels.
const STEP_ICONS: Record<string, React.ReactNode> = {
  link: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" />
      <path d="M17.5 14.5l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8z" />
    </svg>
  ),
  target: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19c.9-3.2 3.6-5 7-5s6.1 1.8 7 5" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.2 5.5 2 6.5H4c.8-1 2-2.5 2-6.5z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 7a8 8 0 1 0 1.5 6" />
      <path d="M20 3v4h-4" />
    </svg>
  ),
  sliders: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M5 8h9M18 8h1M5 16h1M10 16h9" />
      <circle cx="16" cy="8" r="2.2" />
      <circle cx="8" cy="16" r="2.2" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  ),
}

interface TabContent {
  heroVerb: string
  subhead: React.ReactNode
  cta: string
  // Short icon+label rows shown in the hero between the subhead and
  // the CTA (Treatment A — see Claude Design's howitworkschange spec).
  // Replaces the older standalone "HOW IT WORKS" 01/02/03 band.
  heroSteps: { icon: keyof typeof STEP_ICONS; label: string }[]
  featuredNote?: string
}

const TAB_CONTENT: Record<HeaderTab, TabContent> = {
  view: {
    heroVerb: 'posted',
    subhead: (
      <>
        Share and get matched<br />
        with exclusive in-person events and conferences — for free.
      </>
    ),
    cta: 'Create Profile',
    heroSteps: [
      { icon: 'user', label: 'Share your profile & interests' },
      { icon: 'bell', label: 'Get notified of matching events' },
      { icon: 'refresh', label: 'Refine your profile to improve matches' },
    ],
  },
  contribute: {
    heroVerb: 'broadcast',
    subhead: (
      <>
        Contribute an event in seconds —<br />
        we share it with the executives whose profile fits.
      </>
    ),
    cta: 'Share Event',
    heroSteps: [
      { icon: 'link', label: 'Share an event link' },
      { icon: 'spark', label: 'Our AI extracts the details' },
      { icon: 'target', label: 'Matched to the right execs' },
    ],
  },
  partner: {
    heroVerb: 'promoted',
    subhead: (
      <>
        We partner (for free) with <span style={{ color: '#c9a86a', fontWeight: 600 }}>communities</span>,{' '}
        <span style={{ color: '#c9a86a', fontWeight: 600 }}>companies</span> and{' '}
        <span style={{ color: '#c9a86a', fontWeight: 600 }}>connectors</span><br />
        to connect executives to great events.
      </>
    ),
    cta: 'Apply to Partner',
    heroSteps: [],
  },
}

export default function Home() {
  const [tab, setTab] = useState<HeaderTab>('view')
  const [mode, setMode] = useState<Mode>('landing')
  const [showLogin, setShowLogin] = useState(false)
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [sideEventModal, setSideEventModal] = useState<'dreamforce' | 'unbound' | null>(null)
  const [eventCount, setEventCount] = useState(0)
  const [partners, setPartners] = useState<Partner[]>([])
  const [featuredEvents, setFeaturedEvents] = useState<FeaturedEvent[]>([])
  const [matches30, setMatches30] = useState<number | null>(null)
  const [authInvalid, setAuthInvalid] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  // Surface ?auth=invalid as a visible banner — set by /api/auth/verify
  // when a magic-link token is missing, expired, or already used. Before
  // this, the user was bounced silently to the homepage and saw the
  // normal "Create Profile" CTA, which read as "my account doesn't
  // exist."
  // ?apply=partner deep-links into the Partner Apply chat surface so
  // CTAs elsewhere (e.g. /host's "Apply to become a partner") can land
  // visitors directly on the form instead of the marketing landing.
  // ?tab=<view|contribute|partner> lands on the named tab so off-site
  // CTAs (e.g. the dashboard's "Share event" growth modal) can deep-link
  // to the right surface in a new tab.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'invalid') setAuthInvalid(true)
    if (params.get('apply') === 'partner') {
      setTab('partner')
      setMode('active')
    }
    const tabParam = params.get('tab')
    if (tabParam === 'view' || tabParam === 'contribute' || tabParam === 'partner') {
      setTab(tabParam)
    }
  }, [])

  useEffect(() => {
    fetch('/api/events-count')
      .then((r) => r.json())
      .then((d: { count: number }) => setEventCount(d.count))
      .catch(() => {})

    fetch('/api/partners')
      .then((r) => r.json())
      .then((d: { partners: Partner[] }) => setPartners(d.partners ?? []))
      .catch(() => {})

    fetch('/api/featured-events')
      .then((r) => r.json())
      .then((d: { events: FeaturedEvent[] }) => setFeaturedEvents(d.events ?? []))
      .catch(() => {})

    fetch('/api/match-stats')
      .then((r) => r.json())
      .then((d: { matches30: number }) => setMatches30(d.matches30 ?? 0))
      .catch(() => {})

    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { user: unknown }) => setIsLoggedIn(!!d.user))
      .catch(() => {})

  }, [])

  // Body class scopes the dark theme to this page only. Removed on
  // unmount so client-side navigation to /dashboard, /faq, etc. doesn't
  // carry the After Hours palette into Salon surfaces.
  useEffect(() => {
    document.body.classList.add('theme-after-hours')
    return () => document.body.classList.remove('theme-after-hours')
  }, [])

  function handleCTA() {
    // On Contribute the hero CTA opens the same modal as the header
    // "Add Event" button — single canonical entry point for event
    // submission. The chat-style ShareEventTab is left intact (still
    // mounted via ActiveMode) for re-use later.
    if (tab === 'contribute') {
      setShowAddEvent(true)
      return
    }
    setMode('active')
  }
  function handleBack() {
    setMode('landing')
  }
  function selectTab(t: HeaderTab) {
    setTab(t)
    setMode('landing')
  }

  // Scroll to top on tab / mode change — instant, not smooth, so mobile
  // Safari doesn't race the DOM swap.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [mode, tab])

  const content = TAB_CONTENT[tab]
  // Header right-slot CTA varies by tab so each surface has the most
  // useful next action front and centre:
  //   - View → Dashboard (logged-in users go straight to matches;
  //     logged-out users land on the magic-link prompt).
  //   - Contribute → Add Event modal — bare mailto silently fails
  //     when no mail handler is configured (common on Chrome without
  //     a Gmail handler set), so the modal exposes the address with
  //     copy/Gmail/default-mail-app launchers.
  //   - Partner → /host so partners running events get to their host
  //     dashboard in one click.
  // Single gold pill button replaces the prior pale text link.
  const pillStyle: React.CSSProperties = {
    background: '#c9a86a',
    color: '#1b1814',
    padding: '8px 16px',
    letterSpacing: '.01em',
    border: 'none',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  }
  const pillClass = 'rounded-pill text-[13px] font-semibold transition-colors'
  // Small padlock — signals to first-time visitors that the
  // Dashboard / Host Dashboard buttons land on an auth-gated surface.
  const lockIcon = (
    <svg
      aria-hidden
      width="11"
      height="13"
      viewBox="0 0 14 16"
      fill="none"
      style={{ flexShrink: 0 }}
    >
      <rect
        x="2"
        y="7"
        width="10"
        height="7.5"
        rx="1.5"
        fill="#1b1814"
      />
      <path
        d="M4 7V4.5a3 3 0 0 1 6 0V7"
        stroke="#1b1814"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
  const headerRight =
    tab === 'contribute' ? (
      <button
        onClick={() => setShowAddEvent(true)}
        className={pillClass}
        style={pillStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#d5b87c')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#c9a86a')}
      >
        Share Event
      </button>
    ) : isLoggedIn ? (
      <a
        href={tab === 'partner' ? '/host' : '/dashboard'}
        className={pillClass}
        style={pillStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#d5b87c')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#c9a86a')}
      >
        {lockIcon}
        {tab === 'partner' ? 'Host Dashboard' : 'Dashboard'}
      </a>
    ) : (
      <button
        onClick={() => setShowLogin(true)}
        className={pillClass}
        style={pillStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#d5b87c')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#c9a86a')}
      >
        Log in
      </button>
    )

  return (
    <div
      className="min-h-screen flex flex-col overflow-x-hidden"
      style={{ background: '#1b1814', color: '#ece6da' }}
    >
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {showAddEvent && (
        <AddEventModal
          onClose={() => setShowAddEvent(false)}
          onShareOnSite={() => {
            // Drop the modal and walk the user into the chat-style
            // contribute flow — same path the Share Event hero CTA used
            // to fire before we centralised everything through this
            // modal.
            setShowAddEvent(false)
            setTab('contribute')
            setMode('active')
          }}
        />
      )}
      {sideEventModal && (
        <SideEventModal
          which={sideEventModal}
          onClose={() => setSideEventModal(null)}
          onShareOnSite={() => {
            setSideEventModal(null)
            setTab('contribute')
            setMode('active')
          }}
        />
      )}

      <AfterHoursHeader
        activeTab={tab}
        onTabChange={selectTab}
        onLogoClick={() => setMode('landing')}
        rightSlot={headerRight}
      />

      <main className="flex-1 flex flex-col">
        {authInvalid && (
          <div
            className="mx-auto w-full max-w-[880px] mt-6 sm:mt-8 px-5 sm:px-10"
          >
            <div
              className="flex items-start gap-3 rounded-[10px] border px-4 py-3.5"
              style={{
                background: 'rgba(201,168,106,0.08)',
                borderColor: 'rgba(201,168,106,0.32)',
                color: 'rgba(236,230,218,.85)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  marginTop: 8,
                  background: '#c9a86a',
                  transform: 'rotate(45deg)',
                  flexShrink: 0,
                }}
              />
              <div className="flex-1 text-[13.5px] leading-relaxed">
                <strong style={{ color: '#ece6da' }}>
                  That sign-in link didn&rsquo;t work.
                </strong>{' '}
                It may have already been used or expired. Use{' '}
                <button
                  onClick={() => setShowLogin(true)}
                  style={{
                    color: '#c9a86a',
                    textDecoration: 'underline',
                    textUnderlineOffset: 3,
                  }}
                >
                  Log in
                </button>{' '}
                to request a fresh one.
              </div>
              <button
                onClick={() => setAuthInvalid(false)}
                aria-label="Dismiss"
                className="text-[18px] leading-none"
                style={{
                  color: 'rgba(236,230,218,.5)',
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                &times;
              </button>
            </div>
          </div>
        )}
        {mode === 'landing' ? (
          <Landing
            tab={tab}
            content={content}
            partners={partners}
            featuredEvents={featuredEvents}
            matches30={matches30}
            onCTA={handleCTA}
            onSideEvent={setSideEventModal}
          />
        ) : (
          <ActiveMode tab={tab} eventCount={eventCount} onBack={handleBack} onShowPartner={() => selectTab('partner')} />
        )}
      </main>

      <Footer />
    </div>
  )
}

// ---------------- Header ----------------

function AfterHoursHeader({
  activeTab,
  onTabChange,
  onLogoClick,
  rightSlot,
}: {
  activeTab: HeaderTab
  onTabChange: (t: HeaderTab) => void
  onLogoClick: () => void
  rightSlot: React.ReactNode
}) {
  return (
    <div
      style={{
        borderBottom: '1px solid rgba(236,230,218,.13)',
      }}
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-11 py-4 sm:py-5 flex sm:grid sm:grid-cols-[1fr_auto_1fr] items-center justify-between gap-3">
        <button
          onClick={onLogoClick}
          aria-label="Whispered Events home"
          className="hidden sm:flex items-center gap-2.5 sm:justify-self-start"
        >
          <DiamondMark />
          <span
            style={{
              fontFamily: SERIF,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '.01em',
              color: '#ece6da',
            }}
          >
            Whispered <span style={{ fontStyle: 'italic', color: '#c9a86a' }}>Events</span>
          </span>
        </button>

        <SegmentedToggle activeTab={activeTab} onChange={onTabChange} />

        <div className="sm:justify-self-end flex items-center gap-3 sm:gap-4">
          {rightSlot}
        </div>
      </div>
    </div>
  )
}

function DiamondMark() {
  return (
    <span
      aria-hidden
      style={{
        width: 7,
        height: 7,
        background: '#c9a86a',
        transform: 'rotate(45deg)',
        display: 'inline-block',
      }}
    />
  )
}

function SegmentedToggle({
  activeTab,
  onChange,
}: {
  activeTab: HeaderTab
  onChange: (t: HeaderTab) => void
}) {
  const tabs: { id: HeaderTab; label: string; short: string }[] = [
    { id: 'view', label: 'Find Events', short: 'Find' },
    { id: 'contribute', label: 'Contribute', short: 'Share' },
    { id: 'partner', label: 'Partner', short: 'Partner' },
  ]
  return (
    <nav
      className="flex gap-1 p-1 rounded-full border min-w-0"
      style={{
        background: 'rgba(236,230,218,.05)',
        borderColor: 'rgba(236,230,218,.13)',
      }}
    >
      {tabs.map((t) => {
        const active = activeTab === t.id
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className="px-3 sm:px-[17px] py-[7px] rounded-full text-[12px] sm:text-[13px] font-semibold whitespace-nowrap transition-colors"
            style={{
              background: active ? '#c9a86a' : 'transparent',
              color: active ? '#1b1814' : 'rgba(236,230,218,.58)',
              letterSpacing: '.02em',
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.color = '#ece6da'
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.color = 'rgba(236,230,218,.58)'
            }}
          >
            <span className="sm:hidden">{t.short}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

// ---------------- Landing ----------------

function Landing({
  tab,
  content,
  partners,
  featuredEvents,
  matches30,
  onCTA,
  onSideEvent,
}: {
  tab: HeaderTab
  content: TabContent
  partners: Partner[]
  featuredEvents: FeaturedEvent[]
  matches30: number | null
  onCTA: () => void
  onSideEvent: (which: 'dreamforce' | 'unbound') => void
}) {
  // Carousel uses every event we have an image for (no top-N truncation
  // since the user scrolls horizontally instead of seeing them all
  // stacked). Fall back to the top-3 vertical card list when nothing
  // has an image yet so the section isn't empty during the early days
  // of the Image field rollout.
  const slides = featuredEvents.filter((e) => !!e.imageUrl)
  const featuredFallback = featuredEvents.slice(0, 3)
  const featuredLabel = 'Example Past Events'

  return (
    <div className="animate-fade-in" key={tab}>
      {/* Hero */}
      <section className="text-center px-5 sm:px-10 pt-10 sm:pt-[64px] pb-7 sm:pb-7 max-w-[880px] mx-auto">
        <h1
          style={{
            fontFamily: SERIF,
            fontWeight: 500,
            fontSize: 'clamp(34px, 5.5vw, 52px)',
            lineHeight: 1.04,
            margin: 0,
            letterSpacing: '.005em',
            color: '#ece6da',
          }}
        >
          The best events aren&rsquo;t {content.heroVerb}.
          <br />
          <span style={{ fontStyle: 'italic', color: '#c9a86a' }}>
            They&rsquo;re whispered.
          </span>
        </h1>

        <p
          className="text-[15px] sm:text-[17px]"
          style={{
            lineHeight: 1.65,
            color: 'rgba(236,230,218,.6)',
            maxWidth: 560,
            margin: '32px auto 0',
          }}
        >
          {content.subhead}
        </p>

        {/* Inline three-step rundown — replaces the standalone HOW IT
            WORKS band that used to live further down the page. */}
        <HeroSteps steps={content.heroSteps} />

        {/* CTA — hidden on partner tab (button moves below the partner cards) */}
        {tab !== 'partner' && (
          <div className="mt-9 flex justify-center">
            <button
              onClick={onCTA}
              className="rounded-pill text-[14px] font-semibold transition-colors"
              style={{
                background: '#c9a86a',
                color: '#1b1814',
                padding: '14px 28px',
                letterSpacing: '.01em',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#d5b87c')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#c9a86a')}
            >
              {content.cta}
            </button>
          </div>
        )}

        {/* Find Events tab: live counter of matches notified in the
            last 30 days. Number rendered in italic-champagne Cormorant
            with the same underline treatment as the Contribute /
            Partner tab links — visually a sibling, not a CTA. */}
        {tab === 'view' && matches30 !== null && matches30 > 0 && (
          <p
            className="mt-5 text-center"
            style={{
              fontSize: 14,
              lineHeight: 1.5,
              color: 'rgba(236,230,218,.7)',
            }}
          >
            <span
              style={{
                fontFamily: SERIF,
                fontStyle: 'italic',
                fontSize: 18,
                color: '#c9a86a',
                textDecoration: 'underline',
                textUnderlineOffset: 4,
                textDecorationColor: 'rgba(201,168,106,.4)',
                marginRight: 6,
              }}
            >
              {matches30.toLocaleString()}
            </span>
            event matches in past 30 days
          </p>
        )}



        {/* Partner tab: "see all our partners" link lives below the
            marquee at the bottom of the page (see partner section
            below) so the social proof + browse path stay together. */}
      </section>

      {/* Side Events banners — Dreamforce + Unbound. Shown on Find
          Events and Contribute tabs; hidden on Partner tab. */}
      {tab !== 'partner' && (
        <SideEventBanners
          onDreamforce={() => onSideEvent('dreamforce')}
          onUnbound={() => onSideEvent('unbound')}
        />
      )}

      {/* Bottom section: Find Events / Contribute show example past
          events. Partner tab shows the partner marquee instead — the
          strongest social proof for prospects evaluating whether to
          host with us. */}
      {tab === 'partner'
        ? <PartnerTypeSection partners={partners} onApply={onCTA} />
        : (slides.length > 0 || featuredFallback.length > 0) && (
            <section className="max-w-[1080px] mx-auto px-5 sm:px-11 pb-16 sm:pb-[66px]">
              <div
                className="mb-[18px]"
                style={{
                  fontSize: 11,
                  letterSpacing: '.3em',
                  textTransform: 'uppercase',
                  color: 'rgba(236,230,218,.4)',
                }}
              >
                {featuredLabel}
              </div>
              {slides.length > 0 ? (
                <FeaturedCarousel events={slides} />
              ) : (
                <div className="flex flex-col gap-3">
                  {featuredFallback.map((e) => (
                    <FeaturedRow key={e.id} event={e} />
                  ))}
                </div>
              )}
              {content.featuredNote && (
                <div
                  className="mt-3.5"
                  style={{
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: 'rgba(236,230,218,.4)',
                    maxWidth: 640,
                  }}
                >
                  {content.featuredNote}
                </div>
              )}
            </section>
          )}
    </div>
  )
}

// Horizontal image carousel for the Example Past Events / Recent
// partner events section. No autoplay — left/right buttons scroll
// one card at a time, and the scroller's native overflow keeps swipe
// gestures working on touch devices. Each image is wrapped in an
// anchor to the event link.
//
// Card aspect ratio is 1:1 — Luma (the modal event-page source for us)
// serves a 1080×1080 og:image, so a square keeps the entire poster on
// screen. Non-square sources will get a center-crop instead of having
// their tops sliced off.
const CARD_SIZE = 260

// "How it works" — three evenly-spaced icon + label items rendered in
// the hero between the subhead and the CTA. No numbers, no connectors:
// the standalone HOW IT WORKS band that used to live further down the
// page is replaced by this inline strip across every tab.
function HeroSteps({ steps }: { steps: { icon: keyof typeof STEP_ICONS; label: string }[] }) {
  if (!steps.length) return null
  return (
    <div
      className="mx-auto mt-9 grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6"
      style={{ maxWidth: 720 }}
    >
      {steps.map((s, i) => (
        <div key={i} className="flex items-center justify-center gap-3">
          <span style={{ color: '#c9a86a', flexShrink: 0, display: 'inline-flex' }}>
            {STEP_ICONS[s.icon]}
          </span>
          <span
            className="text-left"
            style={{ fontSize: 14.5, lineHeight: 1.3, color: 'rgba(236,230,218,.78)' }}
          >
            {s.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function FeaturedCarousel({ events }: { events: FeaturedEvent[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const settleTimer = useRef<number | null>(null)

  // Triple-buffer the events so the wrap is seamless. The middle copy
  // is the "live" view; the first and third copies act as bleed area
  // so the user can scroll one full copy-width in either direction
  // before we silently teleport back into the middle. Because copies
  // are byte-identical, the teleport is visually invisible.
  const tripled = [...events, ...events, ...events]
  const step = CARD_SIZE + 12
  const setWidth = events.length * step

  useEffect(() => {
    // Place the user at the start of the middle copy on mount so they
    // have a full copy of buffer in both directions.
    const el = scrollerRef.current
    if (!el || setWidth === 0) return
    el.scrollLeft = setWidth
  }, [setWidth])

  // After scroll settles (either after a smooth animation completes
  // or after the user finishes a swipe), if we've drifted out of the
  // middle copy's range, teleport silently back in. The check waits
  // for inactivity so it never interrupts an in-progress animation.
  function scheduleNormalize() {
    if (settleTimer.current) window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      const el = scrollerRef.current
      if (!el || setWidth === 0) return
      if (el.scrollLeft >= 2 * setWidth) {
        el.scrollLeft -= setWidth
      } else if (el.scrollLeft < setWidth) {
        el.scrollLeft += setWidth
      }
    }, 200)
  }

  function scrollByCard(dir: -1 | 1) {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: step * dir, behavior: 'smooth' })
    scheduleNormalize()
  }

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        onScroll={scheduleNormalize}
        className="flex gap-3 overflow-x-auto pb-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <style>{`.featured-carousel::-webkit-scrollbar { display: none; }`}</style>
        {tripled.map((e, i) => {
          const img = (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={e.imageUrl}
              alt={e.name}
              className="w-full h-full object-cover rounded-[14px] transition-opacity"
              style={{ border: '1px solid rgba(236,230,218,.16)' }}
              loading="lazy"
            />
          )
          const inner = (
            <div
              className="shrink-0 overflow-hidden rounded-[14px]"
              style={{ width: CARD_SIZE, height: CARD_SIZE }}
            >
              {img}
            </div>
          )
          // Each event id appears three times — disambiguate with the
          // copy index so React doesn't share state across clones.
          const key = `${e.id}-${i}`
          if (!e.link) return <div key={key}>{inner}</div>
          return (
            <a
              key={key}
              href={e.link}
              target="_blank"
              rel="noopener noreferrer"
              title={e.name}
              className="block hover:opacity-90 transition-opacity"
            >
              {inner}
            </a>
          )
        })}
      </div>

      <CarouselButton dir="left" onClick={() => scrollByCard(-1)} />
      <CarouselButton dir="right" onClick={() => scrollByCard(1)} />
    </div>
  )
}

function CarouselButton({
  dir,
  onClick,
}: {
  dir: 'left' | 'right'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === 'left' ? 'Scroll left' : 'Scroll right'}
      className="absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-colors"
      style={{
        [dir]: 8,
        width: 48,
        height: 48,
        background: '#c9a86a',
        border: '1px solid #c9a86a',
        color: '#1b1814',
        fontSize: 22,
        fontWeight: 600,
        lineHeight: 1,
        boxShadow: '0 4px 16px rgba(0,0,0,.45)',
        cursor: 'pointer',
      } as React.CSSProperties}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#d5b87c')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '#c9a86a')}
    >
      {dir === 'left' ? '‹' : '›'}
    </button>
  )
}

function FeaturedRow({ event }: { event: FeaturedEvent }) {
  const dateText = formatEventDate(event.date, { month: 'short', day: 'numeric' }).toUpperCase()
  const body = (
    <div
      className="flex items-center justify-between gap-5 sm:gap-6 rounded-[14px] border px-5 sm:px-[30px] py-5 sm:py-[26px] transition-colors"
      style={{
        borderColor: 'rgba(236,230,218,.16)',
        background: 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(201,168,106,.5)'
        e.currentTarget.style.background = 'rgba(201,168,106,.04)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(236,230,218,.16)'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <div className="flex items-center gap-4 sm:gap-5 min-w-0 flex-1">
        {event.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.imageUrl}
            alt=""
            className="rounded-[10px] object-cover shrink-0"
            style={{
              width: 64,
              height: 64,
              border: '1px solid rgba(236,230,218,.12)',
            }}
            loading="lazy"
          />
        )}
        <div className="min-w-0 flex-1">
          <div
            style={{
              fontFamily: SERIF,
              fontSize: 'clamp(19px, 2.6vw, 25px)',
              lineHeight: 1.2,
              color: '#ece6da',
            }}
            className="truncate"
          >
            {event.name}
          </div>
          <div
            className="mt-1.5"
            style={{
              fontSize: 13,
              color: 'rgba(236,230,218,.5)',
            }}
          >
            {event.location || 'Location TBD'}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        {dateText && (
          <div
            style={{
              fontSize: 13,
              color: '#c9a86a',
              letterSpacing: '.04em',
            }}
          >
            {dateText}
          </div>
        )}
        <div
          className="mt-1"
          style={{
            fontSize: 12,
            color: 'rgba(236,230,218,.45)',
          }}
        >
          View details &rarr;
        </div>
      </div>
    </div>
  )
  if (!event.link) return body
  return (
    <a href={event.link} target="_blank" rel="noopener noreferrer" className="block">
      {body}
    </a>
  )
}

// ---------------- Active mode (chat surface) ----------------

function ActiveMode({
  tab,
  eventCount,
  onBack,
  onShowPartner,
}: {
  tab: HeaderTab
  eventCount: number
  onBack: () => void
  onShowPartner: () => void
}) {
  // The "← Back" link now lives inside each tab component (rendered
  // via BackLink at the top of the chat surface) so the behavior can
  // be context-aware: ViewEventsTab steps backward through its form
  // history, the others return straight to landing. One entry point,
  // consistent treatment across tabs.
  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {tab === 'view' && (
        <ViewEventsTab eventCount={eventCount} startAtForm onReturnHome={onBack} />
      )}
      {tab === 'contribute' && (
        <ShareEventTab onDone={onBack} onShowPartner={onShowPartner} />
      )}
      {tab === 'partner' && <PartnerApplyTab onDone={onBack} />}
    </div>
  )
}

// ---------------- Side Event Banners ----------------

const POPPINS = 'var(--font-poppins), "Poppins", system-ui, sans-serif'
const PLAYFAIR_ITALIC = 'var(--font-playfair-display), "Playfair Display", Georgia, serif'

function BannerArrow({ nudge }: { nudge: boolean }) {
  return (
    <svg
      width="13"
      height="11"
      viewBox="0 0 13 11"
      fill="none"
      aria-hidden
      style={{
        display: 'inline-block',
        flexShrink: 0,
        color: '#c9a24b',
        transition: 'transform 0.16s ease',
        transform: nudge ? 'translateX(3px)' : 'translateX(0)',
      }}
    >
      <path
        d="M1 5.5h11M7.5 1l5 4.5-5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SideEventBanners({
  onDreamforce,
  onUnbound,
}: {
  onDreamforce: () => void
  onUnbound: () => void
}) {
  return (
    <section className="max-w-[1080px] mx-auto pb-10">
      <div className="px-5 sm:px-11" style={{ fontSize: 11, letterSpacing: '.3em', textTransform: 'uppercase', color: 'rgba(236,230,218,.4)', marginBottom: 18 }}>
        Whispered Side Events
      </div>
      <div
        className="grid grid-cols-1 sm:grid-cols-2"
        style={{ gap: 6 }}
      >
        {/* Left banner — crop ~12px of transparent PNG padding from the right inner edge */}
        <button
          type="button"
          onClick={onDreamforce}
          className="block w-full transition-opacity hover:opacity-90 cursor-pointer overflow-hidden rounded-[16px]"
          style={{ background: 'none', border: 'none', padding: 0 }}
        >
          <img
            src="/banners/dreamforce-26-banner.png"
            alt="Dreamforce '26 Side Events — San Francisco, September 15–17"
            style={{ display: 'block', width: 'calc(100% + 12px)' }}
          />
        </button>
        {/* Right banner — crop ~12px of transparent PNG padding from the left inner edge */}
        <button
          type="button"
          onClick={onUnbound}
          className="block w-full transition-opacity hover:opacity-90 cursor-pointer overflow-hidden rounded-[16px]"
          style={{ background: 'none', border: 'none', padding: 0 }}
        >
          <img
            src="/banners/unbound-26-banner.png"
            alt="Unbound '26 Side Events — Boston, September 16–18"
            style={{ display: 'block', width: 'calc(100% + 12px)', marginLeft: -12 }}
          />
        </button>
      </div>
    </section>
  )
}

// ---------------- Side Event Modal ----------------

const GOLD = '#c9a86a'
const SIDE_EVENT_CONTENT = {
  dreamforce: {
    title: "Dreamforce '26 Side Events",
    badge: 'Coming Soon',
    body: (
      <>
        Check back in early August for<br />our page with{' '}
        <strong style={{ color: GOLD, fontWeight: 700 }}>every</strong> side event.
      </>
    ),
    cta: (
      <>
        <strong style={{ color: GOLD, fontWeight: 700 }}>Hosting an event at Dreamforce?</strong>{' '}Share here 👇
      </>
    ),
    email: 'event@whispered.com',
    subject: "Dreamforce '26 side event",
  },
  unbound: {
    title: "Unbound '26 Side Events",
    badge: 'Coming Soon',
    body: (
      <>
        Check back in early August for<br />our page with{' '}
        <strong style={{ color: GOLD, fontWeight: 700 }}>every</strong> side event.
      </>
    ),
    cta: (
      <>
        <strong style={{ color: GOLD, fontWeight: 700 }}>Hosting an event at Unbound?</strong>{' '}Share here 👇
      </>
    ),
    email: 'event@whispered.com',
    subject: "Unbound '26 side event",
  },
} as const

function SideEventModal({
  which,
  onClose,
  onShareOnSite,
}: {
  which: 'dreamforce' | 'unbound'
  onClose: () => void
  onShareOnSite: () => void
}) {
  const content = SIDE_EVENT_CONTENT[which]
  const [copied, setCopied] = useState(false)

  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(content.email)}&su=${encodeURIComponent(content.subject)}`
  const mailtoUrl = `mailto:${content.email}?subject=${encodeURIComponent(content.subject)}`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content.email)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // ignore — user can still select the address manually
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,15,10,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-card border p-6"
        style={{ background: '#252220', borderColor: 'rgba(236,230,218,.13)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1 gap-3">
          <div className="flex-1 text-center">
            <h2
              className="font-serif m-0"
              style={{ fontSize: 22, color: '#ece6da', letterSpacing: '-0.01em', lineHeight: 1.2 }}
            >
              {content.title}
            </h2>
            <span
              className="inline-block mt-1.5 rounded-pill px-2 py-0.5 text-[10px] font-semibold tracking-widest uppercase"
              style={{ background: 'rgba(201,168,106,.18)', color: '#c9a86a', letterSpacing: '.12em' }}
            >
              {content.badge}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none shrink-0 mt-0.5"
            style={{ color: 'rgba(236,230,218,.5)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            &times;
          </button>
        </div>

        <div
          className="mb-4 space-y-2 text-center"
          style={{ fontSize: 13.5, color: 'rgba(236,230,218,.78)', lineHeight: 1.55 }}
        >
          <p className="m-0">{content.body}</p>
          <p className="m-0">{content.cta}</p>
        </div>

        <div className="flex flex-col gap-2">
          <a
            href={gmailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-pill text-[13px] font-medium text-center py-2.5 border transition-colors"
            style={{ borderColor: 'rgba(236,230,218,.28)', color: '#ece6da' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#c9a86a'
              e.currentTarget.style.color = '#c9a86a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(236,230,218,.28)'
              e.currentTarget.style.color = '#ece6da'
            }}
          >
            Send via Gmail
          </a>
          <a
            href={mailtoUrl}
            className="rounded-pill text-[13px] font-medium text-center py-2.5 border transition-colors"
            style={{ borderColor: 'rgba(236,230,218,.28)', color: '#ece6da' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#c9a86a'
              e.currentTarget.style.color = '#c9a86a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(236,230,218,.28)'
              e.currentTarget.style.color = '#ece6da'
            }}
          >
            Send with Default Mail App
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-2 rounded-pill text-[13px] font-medium text-center py-2.5 border transition-colors"
            style={{
              borderColor: 'rgba(236,230,218,.28)',
              color: copied ? '#c9a86a' : '#ece6da',
              background: 'transparent',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#c9a86a'
              e.currentTarget.style.color = '#c9a86a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(236,230,218,.28)'
              e.currentTarget.style.color = copied ? '#c9a86a' : '#ece6da'
            }}
            aria-label={`Copy ${content.email} to clipboard`}
          >
            {copied ? `${content.email} (copied!)` : `Email ${content.email}`}
            <CopyIcon />
          </button>
          <button
            type="button"
            onClick={onShareOnSite}
            className="rounded-pill text-[13px] font-medium text-center py-2.5 border transition-colors"
            style={{
              borderColor: 'rgba(236,230,218,.28)',
              color: '#ece6da',
              background: 'transparent',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#c9a86a'
              e.currentTarget.style.color = '#c9a86a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(236,230,218,.28)'
              e.currentTarget.style.color = '#ece6da'
            }}
          >
            Share on site
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------- Footer ----------------

// "Add Event" modal — opened from the Contribute tab's header CTA.
// Bare mailto: silently fails when the browser doesn't have a mail
// handler configured (the most common Chrome-without-Gmail-handler
// case), so the modal exposes the address with a copy button plus
// explicit Gmail and default-mail-app launchers. Everyone has a
// working path.
// Small copy-to-clipboard glyph — two overlapping rectangles. Inline
// SVG keeps the modal dependency-free; no icon library needed for a
// single-use mark.
function CopyIcon() {
  return (
    <svg
      aria-hidden
      width="11"
      height="11"
      viewBox="0 0 14 14"
      fill="none"
      style={{ flexShrink: 0 }}
    >
      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 9V3a1 1 0 0 1 1-1h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}

function AddEventModal({
  onClose,
  onShareOnSite,
}: {
  onClose: () => void
  // Hand the user off to the in-app contribute chat flow instead of
  // the email path. Caller is responsible for closing the modal and
  // switching tab/mode (see render site for the canonical wiring).
  onShareOnSite: () => void
}) {
  const email = 'event@whispered.com'
  const subject = 'Event to share'
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}`
  const mailtoUrl = `mailto:${email}?subject=${encodeURIComponent(subject)}`
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard may be blocked (insecure context, permissions) —
      // user can still drag-select the address.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,15,10,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-card border p-6"
        style={{ background: '#252220', borderColor: 'rgba(236,230,218,.13)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2
            className="font-serif m-0"
            style={{ fontSize: 24, color: '#ece6da', letterSpacing: '-0.01em' }}
          >
            Add an{' '}
            <span style={{ fontStyle: 'italic', color: '#c9a86a' }}>event</span>{' '}
            (anonymously) in seconds
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none"
            style={{ color: 'rgba(236,230,218,.5)' }}
          >
            &times;
          </button>
        </div>
        <div
          className="m-0 mb-4 text-center space-y-1.5"
          style={{ fontSize: 13.5, color: 'rgba(236,230,218,.78)', lineHeight: 1.55 }}
        >
          <p className="m-0">Share a link to any event</p>
          <p className="m-0">
            (one you&rsquo;re running or one you know about)
          </p>
          <p className="m-0">Our AI extracts the details</p>
          <p className="m-0">
            We share the event with the execs whose profile fits
          </p>
          <p className="m-0">You get karma and credits 🥂</p>
        </div>

        <div className="flex flex-col gap-2">
          <a
            href={gmailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-pill text-[13px] font-medium text-center py-2.5 border transition-colors"
            style={{ borderColor: 'rgba(236,230,218,.28)', color: '#ece6da' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#c9a86a'
              e.currentTarget.style.color = '#c9a86a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(236,230,218,.28)'
              e.currentTarget.style.color = '#ece6da'
            }}
          >
            Send via Gmail
          </a>
          <a
            href={mailtoUrl}
            className="rounded-pill text-[13px] font-medium text-center py-2.5 border transition-colors"
            style={{ borderColor: 'rgba(236,230,218,.28)', color: '#ece6da' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#c9a86a'
              e.currentTarget.style.color = '#c9a86a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(236,230,218,.28)'
              e.currentTarget.style.color = '#ece6da'
            }}
          >
            Send with Default Mail App
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-2 rounded-pill text-[13px] font-medium text-center py-2.5 border transition-colors"
            style={{
              borderColor: 'rgba(236,230,218,.28)',
              color: copied ? '#c9a86a' : '#ece6da',
              background: 'transparent',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#c9a86a'
              e.currentTarget.style.color = '#c9a86a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(236,230,218,.28)'
              e.currentTarget.style.color = copied ? '#c9a86a' : '#ece6da'
            }}
            aria-label={`Copy ${email} to clipboard`}
          >
            {copied ? `${email} (copied!)` : `Email ${email}`}
            <CopyIcon />
          </button>
          <button
            type="button"
            onClick={onShareOnSite}
            className="rounded-pill text-[13px] font-medium text-center py-2.5 border transition-colors"
            style={{
              borderColor: 'rgba(236,230,218,.28)',
              color: '#ece6da',
              background: 'transparent',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#c9a86a'
              e.currentTarget.style.color = '#c9a86a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(236,230,218,.28)'
              e.currentTarget.style.color = '#ece6da'
            }}
          >
            Share on site
          </button>
        </div>
      </div>
    </div>
  )
}

const PARTNER_TABS = [
  {
    key: 'Community' as const,
    label: 'Communities',
    heading: 'Bring unique events to your audience',
    bullets: [
      'Customize a feed of events',
      'Share exclusive events with your community',
      'Promote events you run to grow your community',
    ],
  },
  {
    key: 'Company' as const,
    label: 'Marketing & Event Teams',
    heading: 'Promote your event to the right execs',
    bullets: [
      'Customize targeting for your ICP',
      'See the execs who match your events',
      'Feature your brand around marquee events',
    ],
  },
  {
    key: 'Connector' as const,
    label: 'Connectors',
    heading: 'Become THE connector in your region / function',
    bullets: [
      'See all relevant events and execs',
      'Build new relationships with companies and execs',
      'Get early access (and input) for new features',
    ],
  },
]

function PartnerTypeSection({ partners, onApply }: { partners: Partner[]; onApply: () => void }) {
  const [activeKey, setActiveKey] = useState<'Community' | 'Company' | 'Connector'>('Community')
  const scrollRef = useRef<HTMLDivElement>(null)
  const tab = PARTNER_TABS.find((t) => t.key === activeKey)!
  const cards = partners
    .filter((p) => p.type === activeKey)
    .sort((a, b) => {
      if (a.stars !== b.stars) return b.stars - a.stars
      return a.name.localeCompare(b.name)
    })
  const scrollBy = (dir: 'left' | 'right') =>
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -240 : 240, behavior: 'smooth' })

  return (
    <section className="max-w-[1080px] mx-auto px-5 sm:px-11 pb-16 sm:pb-[66px]">
      {/* Tabs — centred */}
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {PARTNER_TABS.map((t) => {
          const active = t.key === activeKey
          return (
            <button
              key={t.key}
              onClick={() => setActiveKey(t.key)}
              className="rounded-pill border text-[13px] px-4 py-2 transition-colors"
              style={{
                background: 'transparent',
                borderColor: active ? '#c9a86a' : 'rgba(236,230,218,0.15)',
                color: active ? '#c9a86a' : 'rgba(236,230,218,0.5)',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Heading + bullets — centred */}
      <div className="mb-7 text-center">
        <h3
          className="m-0 font-serif"
          style={{ fontSize: 22, color: 'rgba(236,230,218,0.95)', lineHeight: 1.2, letterSpacing: '-0.01em' }}
        >
          {tab.heading}
        </h3>
        <ul className="mt-3 m-0 pl-0 list-none inline-flex flex-col gap-1.5 text-left">
          {tab.bullets.map((b) => (
            <li
              key={b}
              className="flex items-start gap-2"
              style={{ fontSize: 14, color: 'rgba(236,230,218,0.6)', lineHeight: 1.5 }}
            >
              <span style={{ color: '#c9a86a', flexShrink: 0 }}>◆</span>
              {b}
            </li>
          ))}
        </ul>
      </div>

      {/* Partner cards */}
      {cards.length > 0 ? (
        <div className="relative">
          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto pb-4 -mx-5 px-5 sm:-mx-11 sm:px-11"
            style={{ scrollSnapType: 'x mandatory', scrollbarWidth: 'none' }}
          >
            {cards.map((p) => (
              <PartnerSlide key={p.id} partner={p} />
            ))}
          </div>
          <CarouselButton dir="left" onClick={() => scrollBy('left')} />
          <CarouselButton dir="right" onClick={() => scrollBy('right')} />
        </div>
      ) : null}

      {/* Apply CTA — below the cards */}
      <div className="mt-9 flex justify-center">
        <button
          onClick={onApply}
          className="rounded-pill text-[14px] font-semibold transition-colors"
          style={{
            background: '#c9a86a',
            color: '#1b1814',
            padding: '14px 28px',
            letterSpacing: '.01em',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#d5b87c')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#c9a86a')}
        >
          Apply to Partner
        </button>
      </div>
    </section>
  )
}

function PartnerSlide({ partner }: { partner: Partner }) {
  return (
    <a
      href={partner.website || '#'}
      target={partner.website ? '_blank' : undefined}
      rel="noopener noreferrer"
      className="flex flex-col rounded-card border shrink-0 overflow-hidden transition-opacity hover:opacity-90"
      style={{
        width: 220,
        scrollSnapAlign: 'start',
        borderColor: 'rgba(0,0,0,0.1)',
        background: '#F1ECE2',
        textDecoration: 'none',
      }}
    >
      <div
        className="flex items-center justify-center"
        style={{ background: '#E8E1D2', height: 88, padding: '0 16px' }}
      >
        {partner.logoUrl ? (
          <img
            src={partner.logoUrl}
            alt={partner.name}
            className="max-h-[64px] w-auto max-w-full object-contain"
          />
        ) : (
          <span
            className="font-serif"
            style={{ fontSize: 15, color: '#3a3028', letterSpacing: '-0.01em' }}
          >
            {partner.name}
          </span>
        )}
      </div>
      <div className="px-3 pt-2.5 pb-3 flex flex-col gap-1.5 flex-1">
        <div
          className="font-serif"
          style={{ fontSize: 15, color: '#2c2318', letterSpacing: '-0.01em', lineHeight: 1.2 }}
        >
          {partner.name}
        </div>
        {partner.description && (
          <p
            style={{
              fontSize: 12,
              color: '#5a4e40',
              lineHeight: 1.45,
              margin: 0,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {partner.description}
          </p>
        )}
        <div className="mt-auto pt-1.5 text-right" style={{ fontSize: 10, color: '#c9a86a', letterSpacing: '0.1em' }}>
          ↗
        </div>
      </div>
    </a>
  )
}

function Footer() {
  return (
    <div
      className="flex items-center justify-center px-4 sm:px-11 py-5 sm:py-[26px]"
      style={{ borderTop: '1px solid rgba(236,230,218,.13)' }}
    >
      <a
        href="/faq"
        className="transition-colors"
        style={{ fontSize: 18, color: '#c9a86a', letterSpacing: '.08em', textDecoration: 'none' }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.75')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
      >
        FAQ
      </a>
    </div>
  )
}
