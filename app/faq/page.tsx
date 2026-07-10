'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import LoginModal from '@/components/LoginModal'
import TopicChips from '@/components/TopicChips'

// Single-question FAQ for v1. The content is small enough that a static
// page is the right shape; if this grows past ~5 questions we can swap
// to an accordion + sections.

export default function FaqPage() {
  const [showLogin, setShowLogin] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  // After Hours palette for the public FAQ.
  useEffect(() => {
    document.body.classList.add('theme-after-hours')
    return () => document.body.classList.remove('theme-after-hours')
  }, [])

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { user: unknown }) => setIsLoggedIn(!!d.user))
      .catch(() => {})
  }, [])

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
    <div className="min-h-screen">
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}

      <Header
        activeTab={null}
        rightSlot={rightSlot}
        onLogoClick={() => (window.location.href = '/')}
      />

      <main className="max-w-[760px] mx-auto px-6 sm:px-8 py-12 pb-20">
        <div className="eyebrow mb-2.5">FAQ</div>
        <h1
          className="font-serif m-0 text-[36px] sm:text-[48px]"
          style={{ lineHeight: 1.05, color: 'var(--ink)', letterSpacing: '-0.01em' }}
        >
          Frequently <span className="italic">asked</span>.
        </h1>

        <section className="mt-10">
          <h2
            className="font-serif m-0"
            style={{
              fontSize: 22,
              lineHeight: 1.2,
              color: 'var(--accent)',
              letterSpacing: '-0.01em',
            }}
          >
            <span style={{ color: 'var(--ink-3)', marginRight: 8 }}>Q:</span>
            What types of events do you have?
          </h2>
          <p
            className="mt-3 mb-3"
            style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6 }}
          >
            <strong style={{ color: 'var(--ink-3)', fontWeight: 600, marginRight: 6 }}>
              A:
            </strong>
            We focus on in-person, director / VP / C-suite level events. We
            have events around the world (with concentrations in the obvious
            big cities in North America). See top topics for events on our platform — but you can add your own topics too!
          </p>
          <div className="mt-4">
            <TopicChips readonly />
          </div>
        </section>

        <section className="mt-12">
          <h2
            className="font-serif m-0"
            style={{
              fontSize: 22,
              lineHeight: 1.2,
              color: 'var(--accent)',
              letterSpacing: '-0.01em',
            }}
          >
            <span style={{ color: 'var(--ink-3)', marginRight: 8 }}>Q:</span>
            How are matches determined?
          </h2>
          <p
            className="mt-3 mb-0"
            style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6 }}
          >
            <strong style={{ color: 'var(--ink-3)', fontWeight: 600, marginRight: 6 }}>
              A:
            </strong>
            We match events on three dimensions:
          </p>

          <ul
            className="mt-4 m-0 pl-5 list-disc space-y-3"
            style={{ color: 'var(--ink-2)' }}
          >
            <Dimension label="Location">
              We match you to events within 150 miles of your location (higher match score for closer events). You can
              update your location anytime in your{' '}
              <Link href="/dashboard">dashboard</Link> (e.g. if you&apos;re
              traveling to a city for work) to have your matches re-run.
            </Dimension>
            <Dimension label="Audience">
              The match between the event&apos;s target audience and information
              we pull from your LinkedIn (function, seniority, work experience)
              plus info you provide (e.g. employment status).
            </Dimension>
            <Dimension label="Interests">
              The match between the event description and your stated interests.
              Update these anytime in your <Link href="/dashboard">dashboard</Link>.
            </Dimension>
          </ul>
        </section>

        <section className="mt-12">
          <h2
            className="font-serif m-0"
            style={{
              fontSize: 22,
              lineHeight: 1.2,
              color: 'var(--accent)',
              letterSpacing: '-0.01em',
            }}
          >
            <span style={{ color: 'var(--ink-3)', marginRight: 8 }}>Q:</span>
            How do I improve my matches?
          </h2>
          <p
            className="mt-3 mb-0"
            style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6 }}
          >
            <strong style={{ color: 'var(--ink-3)', fontWeight: 600, marginRight: 6 }}>
              A:
            </strong>
            Give us feedback — in email or on your dashboard — on each event we send you. It helps us improve the matching algorithm for everyone and improve your matches.
          </p>
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <RatingPill color="#2D6A4F" bg="rgba(45,106,79,0.10)" border="rgba(45,106,79,0.35)" label="Interested">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M5 1v4M11 1v4M2 7h12"/>
              </svg>
            </RatingPill>
            <RatingPill color="#3A5F8A" bg="rgba(58,95,138,0.10)" border="rgba(58,95,138,0.35)" label="Hide">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 14s-6-3.5-6-7.5a4 4 0 0 1 6-3.46A4 4 0 0 1 14 6.5C14 10.5 8 14 8 14z"/>
              </svg>
            </RatingPill>
            <RatingPill color="#8A2A38" bg="rgba(138,42,56,0.10)" border="rgba(201,129,140,0.35)" label="Not a fit">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8"/>
              </svg>
            </RatingPill>
          </div>
        </section>

        <section className="mt-12">
          <h2
            className="font-serif m-0"
            style={{
              fontSize: 22,
              lineHeight: 1.2,
              color: 'var(--accent)',
              letterSpacing: '-0.01em',
            }}
          >
            <span style={{ color: 'var(--ink-3)', marginRight: 8 }}>Q:</span>
            Can I have more than one location for matches?
          </h2>
          <p
            className="mt-3 mb-0"
            style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6 }}
          >
            <strong style={{ color: 'var(--ink-3)', fontWeight: 600, marginRight: 6 }}>
              A:
            </strong>
            We (consciously) have started with allowing users to have just one
            location for event matches at a time. This is because we are
            focused on helping executives find quality events vs. becoming a
            tool for selling ;) If you are traveling you can easily update your
            location to see matches in a new city. We will explore
            multi-location functionality for top contributors in the future — so
            email great events you see to{' '}
            <Link href="mailto:event@whispered.com">event@whispered.com</Link>.
          </p>
        </section>

        <section className="mt-12">
          <h2
            className="font-serif m-0"
            style={{
              fontSize: 22,
              lineHeight: 1.2,
              color: 'var(--accent)',
              letterSpacing: '-0.01em',
            }}
          >
            <span style={{ color: 'var(--ink-3)', marginRight: 8 }}>Q:</span>
            Do I qualify for Whispered Events?
          </h2>
          <p
            className="mt-3 mb-0"
            style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6 }}
          >
            <strong style={{ color: 'var(--ink-3)', fontWeight: 600, marginRight: 6 }}>
              A:
            </strong>
            Whispered Events skews executive-level, but we default to admitting
            everyone who applies (assuming you are positive, professional and
            constructive) — as long as your profile matches your LinkedIn.
            Instead of sending every event to every user, we use your profile
            and interests to surface the ones that actually fit. Final say
            belongs to each organizer — they decide who attends; we just point
            you to the right rooms and make the best matches we can. Rate your
            matches on your{' '}
            <Link href="/dashboard">dashboard</Link> to help us improve the
            events we match to you.
          </p>
        </section>

        <section className="mt-12">
          <h2
            className="font-serif m-0"
            style={{
              fontSize: 22,
              lineHeight: 1.2,
              color: 'var(--accent)',
              letterSpacing: '-0.01em',
            }}
          >
            <span style={{ color: 'var(--ink-3)', marginRight: 8 }}>Q:</span>
            What data do you collect, and how is it used?
          </h2>
          <p
            className="mt-3 mb-0"
            style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6 }}
          >
            <strong style={{ color: 'var(--ink-3)', fontWeight: 600, marginRight: 6 }}>
              A:
            </strong>
            At signup, we collect your LinkedIn profile, email, employment
            status, interests, and location. We never share your email or
            employment status. We may share your name, interests, and location
            with partners running events you match for.
          </p>
        </section>

        <section className="mt-12">
          <h2
            className="font-serif m-0"
            style={{
              fontSize: 22,
              lineHeight: 1.2,
              color: 'var(--accent)',
              letterSpacing: '-0.01em',
            }}
          >
            <span style={{ color: 'var(--ink-3)', marginRight: 8 }}>Q:</span>
            Is Whispered Events really free?
          </h2>
          <p
            className="mt-3 mb-0"
            style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6 }}
          >
            <strong style={{ color: 'var(--ink-3)', fontWeight: 600, marginRight: 6 }}>
              A:
            </strong>
            Yes, Whispered Events is 100% free. Andy (founder of Whispered) is{' '}
            <Link href="https://www.andymowat.com/">passionate about connecting people</Link>{' '}
            and the power of events.
          </p>
        </section>

        <section
          className="mt-14 pt-8 border-t"
          style={{ borderColor: 'var(--rule-soft)' }}
        >
          <p
            className="m-0"
            style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.6 }}
          >
            <strong style={{ color: 'var(--ink)' }}>Questions / suggestions / feedback?</strong>{' '}
            Drop us a note at{' '}
            <Link href="mailto:team@whisperedevents.com">
              team@whisperedevents.com
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  )
}

function Dimension({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <li style={{ fontSize: 14.5, lineHeight: 1.6 }}>
      <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{label}:</strong>{' '}
      {children}
    </li>
  )
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="underline"
      style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
    >
      {children}
    </a>
  )
}

function RatingPill({
  color,
  bg,
  border,
  label,
  children,
}: {
  color: string
  bg: string
  border: string
  label: string
  children: React.ReactNode
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill border text-[12px] font-medium whitespace-nowrap"
      style={{ color, background: bg, borderColor: border }}
    >
      {children}
      {label}
    </span>
  )
}
