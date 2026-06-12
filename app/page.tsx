'use client'

import { useState, useEffect } from 'react'
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
  subhead: React.ReactNode
  cta: string
  steps: string[]
  featuredNote?: string
}

const TAB_CONTENT: Record<HeaderTab, TabContent> = {
  view: {
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
    featuredNote:
      '* To see exclusive dinners / intimate events, create a profile to see which you match.',
  },
  contribute: {
    subhead: (
      <>
        Contribute an event in seconds —<br />
        we share it with the executives whose profile fits.
      </>
    ),
    cta: 'Share Event',
    steps: [
      'Share an event link',
      'Our AI extracts the information for you to confirm',
      'Event shared just with executives whose profiles fit',
    ],
    featuredNote: '* Or just email any event link to event@whispered.com — same flow.',
  },
  partner: {
    subhead: (
      <>
        Promote your event to the right execs —<br />
        the people whose profile fits, not a generic blast.
      </>
    ),
    cta: 'Apply to Partner',
    steps: [
      'Share (and update) events you are running',
      'Customize targeting for your events',
      'Get a customized widget/feed of events for your community',
    ],
    featuredNote: '* Recent events from communities & firms we partner with.',
  },
}

export default function Home() {
  const [tab, setTab] = useState<HeaderTab>('view')
  const [mode, setMode] = useState<Mode>('landing')
  const [showLogin, setShowLogin] = useState(false)
  const [eventCount, setEventCount] = useState(0)
  const [partners, setPartners] = useState<Partner[]>([])
  const [featuredEvents, setFeaturedEvents] = useState<FeaturedEvent[]>([])
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [matches30, setMatches30] = useState<number | null>(null)

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
  const headerRight = isLoggedIn ? (
    <a
      href="/dashboard"
      className="text-[13px] transition-colors"
      style={{ color: 'rgba(236,230,218,.62)' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = '#ece6da')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(236,230,218,.62)')}
    >
      Dashboard
    </a>
  ) : (
    <button
      onClick={() => setShowLogin(true)}
      className="text-[13px] transition-colors"
      style={{ color: 'rgba(236,230,218,.62)' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = '#ece6da')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(236,230,218,.62)')}
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

      <AfterHoursHeader
        activeTab={tab}
        onTabChange={selectTab}
        onLogoClick={() => setMode('landing')}
        rightSlot={headerRight}
      />

      <main className="flex-1 flex flex-col">
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
  const featured = featuredEvents.slice(0, 3)
  const featuredLabel = tab === 'partner' ? 'Recent partner events' : 'Featured Events'

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
          The best events aren&rsquo;t posted.
          <br />
          <span style={{ fontStyle: 'italic', color: '#c9a86a' }}>
            They&rsquo;re whispered.
          </span>
        </h1>
        {/* Partner row — leads under the headline so the social proof
            lands first, then the per-tab value prop below it. */}
        {partners.some((p) => p.featured) && (
          <div className="mt-9">
            <div
              className="mb-[18px]"
              style={{
                fontSize: 11,
                letterSpacing: '.26em',
                textTransform: 'uppercase',
                color: 'rgba(236,230,218,.38)',
              }}
            >
              Partnered with the best communities &amp; companies
            </div>
            <PartnerMarquee partners={partners} />
          </div>
        )}

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

        {/* Contribute tab: subtler alternative under the CTA. Uppercase
            eyebrow OR, body in sans, email in italic-champagne Cormorant
            to echo the headline's 'They're whispered' moment. */}
        {tab === 'contribute' && (
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
                fontSize: 11,
                letterSpacing: '.26em',
                textTransform: 'uppercase',
                color: 'rgba(236,230,218,.42)',
                marginRight: 10,
              }}
            >
              Or
            </span>
            email link to{' '}
            <a
              href="mailto:event@whispered.com"
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
              event@whispered.com
            </a>
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

      {/* Featured */}
      {featured.length > 0 && (
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
          <div className="flex flex-col gap-3">
            {featured.map((e) => (
              <FeaturedRow key={e.id} event={e} />
            ))}
          </div>
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
      <div className="min-w-0">
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
  return (
    <div className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <button
        onClick={onBack}
        className="text-[12px] mb-5 transition-colors"
        style={{ color: 'rgba(236,230,218,.5)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = '#c9a86a')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(236,230,218,.5)')}
      >
        ← Back
      </button>
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
