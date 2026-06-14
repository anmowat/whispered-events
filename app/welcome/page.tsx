'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/Header'
import TopicChips from '@/components/TopicChips'
import { UserProfile } from '@/lib/types'

// Invite-style quick-signup landing. Email + LinkedIn + Learn arrive in
// the URL (?email=...&linkedin=...&learn=...) — the visitor only fills
// Interest, City, Frequency. When the URL is missing email or LinkedIn
// we surface the fields so the form still works.
//
// Defaults written to Airtable: Employment='Searching', Learn from the
// URL (falls back to '' if absent). On success we hit the same
// /api/submit-profile endpoint the chat flow uses, so the downstream
// pipeline (Resend welcome, digest seeding, Airtable enrich) is
// identical.

// Frequency display mirrors ViewEventsTab: backend stores 'Paused',
// users see 'Dashboard Only'.
const FREQUENCY_OPTIONS = ['As they arrive', 'Weekly', 'Monthly', 'Paused'] as const
function displayFrequency(value: string): string {
  return value === 'Paused' ? 'Dashboard Only' : value
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomePageInner />
    </Suspense>
  )
}

function WelcomePageInner() {
  const params = useSearchParams()
  const emailFromUrl = (params?.get('email') || '').trim()
  const linkedinFromUrl = (params?.get('linkedin') || '').trim()
  const learn = (params?.get('learn') || '').trim()

  // URL values seed the inputs so the user can edit if needed. The
  // fields render only when the URL didn't carry the value.
  const [email, setEmail] = useState(emailFromUrl)
  const [linkedin, setLinkedin] = useState(linkedinFromUrl)
  const [interest, setInterest] = useState('')
  const [city, setCity] = useState('')
  const [frequency, setFrequency] = useState<string>('Weekly')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 'checking' covers the initial existence check when email arrives in
  // the URL. Existing users get bounced to the homepage so they don't
  // re-submit and trigger a duplicate Airtable record. Failures fall
  // through to 'ready' (fail-open).
  const [checkState, setCheckState] = useState<'checking' | 'ready'>(
    emailFromUrl ? 'checking' : 'ready',
  )

  // Apply After Hours dark palette to the invite landing.
  useEffect(() => {
    document.body.classList.add('theme-after-hours')
    return () => document.body.classList.remove('theme-after-hours')
  }, [])

  useEffect(() => {
    if (!emailFromUrl) return
    let cancelled = false
    fetch(`/api/check-email?email=${encodeURIComponent(emailFromUrl)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { exists?: boolean }) => {
        if (cancelled) return
        if (d.exists) {
          window.location.replace('/')
        } else {
          setCheckState('ready')
        }
      })
      .catch(() => {
        if (!cancelled) setCheckState('ready')
      })
    return () => {
      cancelled = true
    }
  }, [emailFromUrl])

  const needsEmail = !emailFromUrl
  const needsLinkedin = !linkedinFromUrl

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)

    if (!email.trim()) {
      setError('Please enter your email.')
      return
    }
    if (!linkedin.trim()) {
      setError('Please enter your LinkedIn URL.')
      return
    }
    if (!interest.trim() || !city.trim()) {
      setError('Please fill in your topics and city.')
      return
    }

    setSubmitting(true)
    try {
      const profile: UserProfile = {
        email: email.trim(),
        linkedin: linkedin.trim(),
        interest: interest.trim(),
        location: city.trim(),
        frequency,
        learn,
        employment: 'Searching',
        companySize: '',
      }
      const res = await fetch('/api/submit-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        activeTab={null}
        onLogoClick={() => (window.location.href = '/')}
      />

      <main className="flex-1 max-w-[640px] w-full mx-auto px-6 sm:px-8 py-10 pb-20">
        {checkState === 'checking' ? (
          <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>Loading…</p>
        ) : submitted ? (
          <ThankYou />
        ) : (
          <>
            <div className="eyebrow mb-2.5">Exclusive invite</div>
            <h1
              className="font-serif m-0 text-[36px] sm:text-[44px]"
              style={{ lineHeight: 1.05, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              Welcome to <span className="italic">Whispered Events</span>.
            </h1>
            <p
              className="mt-4 mb-0"
              style={{ fontSize: 15.5, color: 'var(--ink-2)', lineHeight: 1.6 }}
            >
              This page lets{' '}
              <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>
                {learn || 'Whispered'}
              </strong>{' '}
              users sign up in seconds.
            </p>
            <p
              className="mt-3 mb-0"
              style={{ fontSize: 15.5, color: 'var(--ink-2)', lineHeight: 1.6 }}
            >
              <a
                href="/"
                className="underline"
                style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
              >
                Whispered Events
              </a>{' '}
              curates the best in-person dinners, conferences,
              and gatherings for senior operators and execs — the ones that
              aren&apos;t widely posted.
            </p>
            <p
              className="mt-3 mb-0"
              style={{ fontSize: 15.5, color: 'var(--ink-2)', lineHeight: 1.6 }}
            >
              We email you events matching your role, location, and interests —
              all for free.
            </p>

            {!needsEmail ? (
              <div
                className="mt-7 rounded-card border p-4"
                style={{
                  background: 'var(--paper)',
                  borderColor: 'var(--rule)',
                }}
              >
                <p
                  className="m-0"
                  style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}
                >
                  We already have your function and level attached to your
                  email{' '}
                  <strong style={{ color: 'var(--ink)' }}>
                    <em>{email}</em>
                  </strong>
                  . Answer the questions below and we&apos;ll create your free
                  Whispered Events account.
                </p>
              </div>
            ) : (
              <p
                className="mt-3 mb-0"
                style={{ fontSize: 15.5, color: 'var(--ink-2)', lineHeight: 1.6 }}
              >
                Quickly answer the questions below and we&apos;ll create your
                free Whispered Events account.
              </p>
            )}

            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              {needsEmail && (
                <Field label="What's your email?">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className={inputCls}
                    required
                  />
                </Field>
              )}

              {needsLinkedin && (
                <Field label="What's your LinkedIn profile URL?" hint="We'll use your profile to automatically enrich your function and seniority.">
                  <input
                    type="url"
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    placeholder="https://www.linkedin.com/in/your-handle"
                    className={inputCls}
                    required
                  />
                </Field>
              )}

              <Field label="What city are you based in?" hint="We'll send events within 100 miles. Pick one primary city — you can change it anytime if you travel.">
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. San Francisco, CA"
                  className={inputCls}
                  required
                />
              </Field>

              <Field label="How often would you like to receive emails with matching events?">
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                  className={`salon-select ${inputCls}`}
                >
                  {FREQUENCY_OPTIONS.map((f) => (
                    <option key={f} value={f}>{displayFrequency(f)}</option>
                  ))}
                </select>
              </Field>

              <Field
                label="What topics are you interested in?"
                hintNode={
                  <>
                    We use your topics (as well as your function/level from your LinkedIn) to find the events that best fit you
                    <br />
                    Pick from frequently used topics below <strong>AND</strong> also feel free to add your own
                    <br />
                    Update anytime on your dashboard
                  </>
                }
              >
                <div className="space-y-3">
                  <textarea
                    value={interest}
                    onChange={(e) => setInterest(e.target.value)}
                    placeholder="e.g. AI agents, RevOps, GTM, Women"
                    rows={3}
                    className={inputCls}
                    required
                  />
                  <TopicChips value={interest} onChange={setInterest} />
                </div>
              </Field>

              {error && (
                <p
                  className="rounded-input border px-3 py-2 text-[13px]"
                  style={{
                    background: 'var(--accent-soft)',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent)',
                  }}
                >
                  {error}
                </p>
              )}

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-pill text-[14px] font-medium text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: 'var(--accent)' }}
                  onMouseEnter={(e) => !submitting && (e.currentTarget.style.background = 'var(--accent-2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
                >
                  {submitting ? 'Submitting…' : 'Create my account'}
                </button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  )
}

function ThankYou() {
  return (
    <div className="text-center py-10">
      <div className="eyebrow mb-2.5">All set</div>
      <h1
        className="font-serif m-0 text-[36px] sm:text-[44px]"
        style={{ lineHeight: 1.05, color: 'var(--ink)', letterSpacing: '-0.01em' }}
      >
        Thank you.
      </h1>
      <p
        className="mt-5 mx-auto"
        style={{ fontSize: 15.5, color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 460 }}
      >
        We&apos;ve submitted your account for approval. You should receive an
        email shortly, and then you&apos;ll start receiving matching events.
      </p>
    </div>
  )
}

function Field({
  label,
  hint,
  hintNode,
  children,
}: {
  label: string
  hint?: string
  hintNode?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span
        className="block mb-1.5"
        style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 500 }}
      >
        {label}
      </span>
      {(hint || hintNode) && (
        <span
          className="block mb-2"
          style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}
        >
          {hintNode ?? hint}
        </span>
      )}
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-input border border-rule bg-white px-3 py-2 text-[14px] text-ink placeholder:opacity-60 focus:outline-none focus:border-accent transition-colors'
