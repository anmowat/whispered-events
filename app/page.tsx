'use client'

import { useEffect, useRef, useState } from 'react'
import { HeaderTab } from '@/components/Header'
import ShareEventTab from '@/components/ShareEventTab'
import PartnerApplyTab from '@/components/PartnerApplyTab'
import ViewEventsTab from '@/components/ViewEventsTab'
import LoginModal from '@/components/LoginModal'
import PartnerMarquee from '@/components/PartnerMarquee'
import { Partner, FeaturedEvent } from '@/lib/airtable'

type Mode = 'landing' | 'active'

// "After Hours" homepage. Warm near-black background, champagne accent.
// The Header / right-slot / chat state machine carries forward — only
// the visual chrome is new. Body gets the `theme-after-hours` class so
// the chat surfaces (ViewEventsTab / ShareEventTab / PartnerApplyTab),
// LoginModal, PartnerMarquee, etc. re-theme via CSS-var overrides
// defined in globals.css.

const SERIF = `'Cormorant Garamond', Georgia, 'Times New Roman', serif`

interface TabContent {
  heroVerb: string
  subhead: React.ReactNode
  cta: string
  steps: string[]
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
    steps: [
      'Share your profile and event interests',
      'Get notified of new matching events',
      'Update your profile to improve matches',
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
    cta: 'Add Event',
    steps: [
      'Share an event link (one you are running or just one you know about)',
      'Our AI extracts the information automatically',
      'Event shared just with executives whose profiles fit',
    ],
  },
  partner: {
    heroVerb: 'promoted',
    subhead: (
      <>
        Promote your event to the right execs —<br />
        the people whose profile fits, not a generic blast.
      </>
    ),
    cta: 'Apply to Partner',
    steps: [
      'Share (and update) events you are running',
      'Customize targeting for your events (i.e. revenue size)',
      'Get a customized widget/feed of events for your community',
    ],
  },
}

export default function Home() {
  const [tab, setTab] = useState<HeaderTab>('view')
  const [mode, setMode] = useState<Mode>('landing')
  const [showLogin, setShowLogin] = useState(false)
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [eventCount, setEventCount] = useState(0)
  const [partners, setPartners] = useState<Partner[]>([])
  const [featuredEvents, setFeaturedEvents] = useState<FeaturedEvent[]>([])
  const [matches30, setMatches30] = useState<number | null>(null)
  const [authInvalid, setAuthInvalid] = useState(false)

  // Surface ?auth=invalid as a visible banner — set by /api/auth/verify
  // when a magic-link token is missing, expired, or already used. Before
  // this, the user was bounced silently to the homepage and saw the
  // normal "Create Profile" CTA, which read as "my account doesn't
  // exist."
  // ?apply=partner deep-links into the Partner Apply chat surface so
  // CTAs elsewhere (e.g. /host's "Apply to become a partner") can land
  // visitors directly on the form instead of the marketing landing.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'invalid') setAuthInvalid(true)
    if (params.get('apply') === 'partner') {
      setTab('partner')
      setMode('active')
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
        Add Event
      </button>
    ) : (
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
    )

  return (
    <div
      className="min-h-screen flex flex-col overflow-x-hidden"
      style={{ background: '#1b1814', color: '#ece6da' }}
    >
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      {showAddEvent && <AddEventModal onClose={() => setShowAddEvent(false)} />}

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
}: {
  tab: HeaderTab
  content: TabContent
  partners: Partner[]
  featuredEvents: FeaturedEvent[]
  matches30: number | null
  onCTA: () => void
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

        {/* CTA */}
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



        {/* Partner tab: under-CTA link to the full /partners directory.
            Same sans + italic-champagne treatment as the Contribute
            tab's email line, minus the OR eyebrow (no alternative
            being offered — just a way to browse). */}
        {tab === 'partner' && (
          <p
            className="mt-5 text-center"
            style={{
              fontSize: 14,
              lineHeight: 1.5,
              color: 'rgba(236,230,218,.7)',
            }}
          >
            see{' '}
            <a
              href="/partners"
              style={{
                fontFamily: SERIF,
                fontStyle: 'italic',
                fontSize: 18,
                color: '#c9a86a',
                textDecoration: 'underline',
                textUnderlineOffset: 4,
                textDecorationColor: 'rgba(201,168,106,.4)',
                marginLeft: 2,
              }}
            >
              all our partners
            </a>
          </p>
        )}
      </section>

      {/* How it works — the uppercase eyebrow itself reads as the
          separator; no hairline above. */}
      <section
        id="how-it-works"
        className="max-w-[1080px] mx-auto px-5 sm:px-11 pt-3 pb-12 sm:pt-4 sm:pb-16"
      >
        <div
          className="text-center mb-9 sm:mb-11"
          style={{
            fontSize: 11,
            letterSpacing: '.3em',
            textTransform: 'uppercase',
            color: 'rgba(236,230,218,.4)',
          }}
        >
          How it works
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-9 sm:gap-[46px]">
          {content.steps.map((step, i) => (
            <div key={i}>
              <div
                style={{
                  fontFamily: SERIF,
                  fontSize: 38,
                  color: '#c9a86a',
                  lineHeight: 1,
                  marginBottom: 16,
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <div
                style={{
                  fontSize: 16,
                  lineHeight: 1.55,
                  color: 'rgba(236,230,218,.82)',
                }}
              >
                {step}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom section: Find Events / Contribute show example past
          events. Partner tab shows the partner marquee instead — the
          strongest social proof for prospects evaluating whether to
          host with us. */}
      {tab === 'partner'
        ? partners.some((p) => p.featured) && (
            <section className="max-w-[1080px] mx-auto px-5 sm:px-11 pb-16 sm:pb-[66px]">
              <div
                className="mb-[18px]"
                style={{
                  fontSize: 11,
                  letterSpacing: '.26em',
                  textTransform: 'uppercase',
                  color: 'rgba(236,230,218,.4)',
                }}
              >
                Partnered with the best communities &amp; companies
              </div>
              <PartnerMarquee partners={partners} />
            </section>
          )
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
  const dateText = event.date
    ? new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
    : ''
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

// ---------------- Footer ----------------

// "Add Event" modal — opened from the Contribute tab's header CTA.
// Bare mailto: silently fails when the browser doesn't have a mail
// handler configured (the most common Chrome-without-Gmail-handler
// case), so the modal exposes the address with a copy button plus
// explicit Gmail and default-mail-app launchers. Everyone has a
// working path.
function AddEventModal({ onClose }: { onClose: () => void }) {
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
            Add an <span style={{ fontStyle: 'italic', color: '#c9a86a' }}>event</span>
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
        <p
          className="m-0 mb-4"
          style={{ fontSize: 13.5, color: 'rgba(236,230,218,.78)', lineHeight: 1.55 }}
        >
          Email us a link to any event (one you&rsquo;re running or one you
          know about). Our AI extracts the details and we share it with the
          executives whose profile fits.
        </p>

        <div className="flex flex-col gap-2">
          <a
            href={gmailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-pill text-[13px] font-semibold text-center py-2.5 transition-colors"
            style={{
              background: '#c9a86a',
              color: '#1b1814',
              letterSpacing: '.01em',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#d5b87c')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#c9a86a')}
          >
            Open in Gmail
          </a>
          <a
            href={mailtoUrl}
            className="rounded-pill text-[13px] font-medium text-center py-2.5 border transition-colors"
            style={{
              borderColor: 'rgba(236,230,218,.28)',
              color: '#ece6da',
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
            Open in default mail app
          </a>
        </div>

        {/* Tertiary fallback for users on a setup where neither launcher
            works — small text link, not a button. Click flips the label
            to "Copied!" so the user knows the action took effect. */}
        <p
          className="m-0 mt-4 text-center"
          style={{ fontSize: 12, color: 'rgba(236,230,218,.5)', lineHeight: 1.5 }}
        >
          Or copy{' '}
          <button
            onClick={handleCopy}
            className="underline"
            style={{
              color: copied ? '#c9a86a' : 'rgba(236,230,218,.7)',
              textUnderlineOffset: 2,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            {copied ? `${email} (copied)` : email}
          </button>
        </p>
      </div>
    </div>
  )
}

function Footer() {
  return (
    <div
      className="flex items-center justify-between px-4 sm:px-11 py-5 sm:py-[26px]"
      style={{
        borderTop: '1px solid rgba(236,230,218,.13)',
        fontSize: 12,
        color: 'rgba(236,230,218,.4)',
      }}
    >
      <span>Whispered Events - Copyright 2026</span>
      <a
        href="/faq"
        className="transition-colors"
        style={{
          letterSpacing: '.08em',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
          textDecorationColor: 'rgba(236,230,218,.25)',
          color: 'rgba(236,230,218,.4)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#c9a86a')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(236,230,218,.4)')}
      >
        FAQ
      </a>
    </div>
  )
}
