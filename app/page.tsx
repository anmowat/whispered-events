'use client'

import { useState, useEffect } from 'react'
import Header, { HeaderTab } from '@/components/Header'
import ShareEventTab from '@/components/ShareEventTab'
import PartnerApplyTab from '@/components/PartnerApplyTab'
import ViewEventsTab from '@/components/ViewEventsTab'
import FeaturedEventsCarousel from '@/components/FeaturedEventsCarousel'
import LoginModal from '@/components/LoginModal'
import Coverage from '@/components/Coverage'
import PartnerMarquee from '@/components/PartnerMarquee'
import { Partner, FeaturedEvent } from '@/lib/airtable'

type Mode = 'landing' | 'active'

// "The Salon" landing. Tab in the header swaps which of three cards
// renders below the hero. The three active-mode tabs route to the
// existing chat components (PartnerApplyTab + ShareEventTab +
// ViewEventsTab) — unchanged behavior, restyled outer chrome only.

export default function Home() {
  const [tab, setTab] = useState<HeaderTab>('view')
  const [mode, setMode] = useState<Mode>('landing')
  const [showLogin, setShowLogin] = useState(false)
  const [eventCount, setEventCount] = useState(0)
  const [partners, setPartners] = useState<Partner[]>([])
  const [featuredEvents, setFeaturedEvents] = useState<FeaturedEvent[]>([])
  const [isLoggedIn, setIsLoggedIn] = useState(false)

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

    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { user: unknown }) => setIsLoggedIn(!!d.user))
      .catch(() => {})
  }, [])

  function handleCTA() {
    setMode('active')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleBack() {
    setMode('landing')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function selectTab(t: HeaderTab) {
    setTab(t)
    setMode('landing')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const rightSlot = isLoggedIn ? (
    <a
      href="/dashboard"
      className="text-[13px] transition-colors"
      style={{ color: 'var(--ink-2)' }}
    >
      Dashboard
    </a>
  ) : (
    <button
      onClick={() => setShowLogin(true)}
      className="text-[13px] transition-colors"
      style={{ color: 'var(--ink-2)' }}
    >
      Log in
    </button>
  )

  return (
    <div className="min-h-screen flex flex-col">
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}

      <Header
        activeTab={tab}
        onTabChange={selectTab}
        rightSlot={rightSlot}
        onLogoClick={handleBack}
      />

      <main className="flex-1 w-full">
        {mode === 'landing' ? (
          <Landing
            tab={tab}
            partners={partners}
            featuredEvents={featuredEvents}
            onCTA={handleCTA}
          />
        ) : (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
            {tab === 'view' && (
              <ViewEventsTab eventCount={eventCount} startAtForm onReturnHome={handleBack} />
            )}
            {tab === 'contribute' && (
              <ShareEventTab onDone={handleBack} onShowPartner={() => selectTab('partner')} />
            )}
            {tab === 'partner' && <PartnerApplyTab onDone={handleBack} />}
          </div>
        )}
      </main>

      <footer
        className="max-w-[1040px] mx-auto w-full px-6 sm:px-8 py-5 pb-7 flex justify-between items-center text-[12px] border-t mt-14"
        style={{ borderColor: 'var(--rule-soft)', color: 'var(--ink-3)' }}
      >
        <span>Whispered Events — for executives</span>
        <span className="font-serif italic">— est. 2026</span>
      </footer>
    </div>
  )
}

function Landing({
  tab,
  partners,
  featuredEvents,
  onCTA,
}: {
  tab: HeaderTab
  partners: Partner[]
  featuredEvents: FeaturedEvent[]
  onCTA: () => void
}) {
  return (
    <div className="flex flex-col items-center px-4 sm:px-6 animate-fade-in">
      {/* Hero */}
      <section className="max-w-[760px] mx-auto pt-12 sm:pt-[60px] pb-7 text-center w-full">
        <h1
          className="font-serif m-0 text-[44px] sm:text-[54px]"
          style={{ lineHeight: 1.05, color: 'var(--ink)', letterSpacing: '-0.01em' }}
        >
          The best events aren&apos;t posted<br />
          they&apos;re <span className="italic">whispered</span>
        </h1>
        <p
          className="font-serif italic mt-3 mb-0 text-[18px] sm:text-[22px]"
          style={{ color: 'var(--ink-2)', lineHeight: 1.25 }}
        >
          contribute and discover exclusive events — 100% free
        </p>
      </section>

      {/* Active card driven by the header tab */}
      <section className="max-w-[520px] w-full mt-5" key={tab}>
        {tab === 'view' && <ViewCard onCTA={onCTA} featuredEvents={featuredEvents} />}
        {tab === 'contribute' && <ContributeCard onCTA={onCTA} featuredEvents={featuredEvents} />}
        {tab === 'partner' && <PartnerCard onCTA={onCTA} featuredEvents={featuredEvents} />}
      </section>

      {/* Coverage */}
      <section className="max-w-[640px] w-full mt-16">
        <Coverage />
      </section>

      {/* Partner marquee */}
      {partners.some((p) => p.featured) && (
        <section className="max-w-[1040px] w-full mt-16">
          <div className="hairline mb-5" />
          <div className="eyebrow text-center mb-4">
            Partnered with the best communities &amp; firms
          </div>
          <PartnerMarquee partners={partners} />
          <div className="flex justify-center mt-6">
            <a
              href="/partners"
              className="rounded-pill text-[12px] font-medium px-4 py-2 transition-colors border"
              style={{
                background: 'var(--paper)',
                color: 'var(--ink-2)',
                borderColor: 'var(--rule)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--paper-2)'
                e.currentTarget.style.color = 'var(--ink)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--paper)'
                e.currentTarget.style.color = 'var(--ink-2)'
              }}
            >
              See all partners →
            </a>
          </div>
        </section>
      )}
    </div>
  )
}

// ----- Landing card primitives -----

function LandingCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-card border"
      style={{
        borderColor: 'var(--accent)',
        background: 'var(--paper)',
        boxShadow: '0 8px 30px -18px rgba(110,31,43,0.5)',
        padding: '28px 28px 26px',
      }}
    >
      <h3
        className="font-serif mt-0 mb-4 m-0"
        style={{
          fontSize: 30,
          lineHeight: 1.15,
          color: 'var(--ink)',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  )
}

function HowItWorks({ items }: { items: string[] }) {
  return (
    <ol className="m-0 p-0 list-none flex flex-col gap-3">
      {items.map((text, i) => (
        <li key={i} className="flex items-start gap-3">
          <span
            className="font-serif shrink-0 grid place-items-center rounded-full"
            style={{
              width: 24,
              height: 24,
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
              background: 'var(--accent-soft)',
              fontSize: 14,
              lineHeight: 1,
              marginTop: 1,
            }}
          >
            {i + 1}
          </span>
          <span style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
            {text}
          </span>
        </li>
      ))}
    </ol>
  )
}

function AccentButton({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full mt-5 rounded-pill text-white font-medium transition-colors flex items-center justify-center gap-2"
      style={{
        padding: '10px 16px',
        background: 'var(--accent)',
        fontSize: 13,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
    >
      {children}
    </button>
  )
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  )
}

function ViewCard({
  onCTA,
  featuredEvents,
}: {
  onCTA: () => void
  featuredEvents: FeaturedEvent[]
}) {
  return (
    <LandingCard title="Get matching exec events emailed - for free">
      <HowItWorks
        items={[
          'Share your profile and event interests',
          'Get notified of new matching events',
          'Update your profile to improve matches',
        ]}
      />
      <AccentButton onClick={onCTA}>
        Create Profile <ArrowIcon />
      </AccentButton>
      <p
        className="text-center mt-3 leading-relaxed"
        style={{ fontSize: 11.5, color: 'var(--ink-3)' }}
      >
        Love what we are doing? Tag{' '}
        <a
          href="https://www.linkedin.com/company/whispered-events/about/?viewAsMember=true"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
        >
          Whispered Events
        </a>{' '}
        on a LinkedIn post
      </p>
      <FeaturedEventsCarousel events={featuredEvents} />
    </LandingCard>
  )
}

function ContributeCard({
  onCTA,
  featuredEvents,
}: {
  onCTA: () => void
  featuredEvents: FeaturedEvent[]
}) {
  return (
    <LandingCard title="Contribute an event in seconds.">
      <HowItWorks
        items={[
          'Share an event link or paste in details',
          'Our AI extracts the information for you to confirm',
          'Event shared just with executives whose profiles fit',
        ]}
      />
      <AccentButton onClick={onCTA}>
        Share Event <ArrowIcon />
      </AccentButton>
      <div className="text-center mt-3 space-y-1.5">
        <p className="leading-relaxed" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          Share an event you are running or just one you are aware of.
        </p>
        <p className="leading-relaxed" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          Share above or email link to{' '}
          <a
            href="mailto:event@whisperedevents.com"
            className="underline"
            style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
          >
            event@whisperedevents.com
          </a>
        </p>
      </div>
      <FeaturedEventsCarousel events={featuredEvents} />
    </LandingCard>
  )
}

function PartnerCard({
  onCTA,
  featuredEvents,
}: {
  onCTA: () => void
  featuredEvents: FeaturedEvent[]
}) {
  return (
    <LandingCard title="Promote your event to the right execs">
      <HowItWorks
        items={[
          'Share (and update) events you are running',
          'Customize targeting for your events',
          'See execs who match your audience',
        ]}
      />
      <AccentButton onClick={onCTA}>
        Apply <ArrowIcon />
      </AccentButton>
      <FeaturedEventsCarousel events={featuredEvents} />
    </LandingCard>
  )
}
