'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/Header'
import { UserProfile } from '@/lib/types'

// Invite-style quick-signup landing. Email + LinkedIn arrive in the URL
// (?email=...&linkedin=...) — the visitor only fills Interest, City,
// Frequency. Learn defaults to "Sage", Employment to "Searching"
// (referral-channel attribution + a sensible neutral). On success we
// hit the same /api/submit-profile endpoint the chat flow uses, so the
// downstream pipeline (Resend welcome, digest seeding, Airtable enrich)
// is identical.

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
  const email = (params?.get('email') || '').trim()
  const linkedin = (params?.get('linkedin') || '').trim()
  const learn = (params?.get('learn') || '').trim()

  const [interest, setInterest] = useState('')
  const [city, setCity] = useState('')
  const [frequency, setFrequency] = useState<string>('Weekly')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasEmail = Boolean(email)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)

    if (!email) {
      setError("We didn't receive your email in the invite link. Please ask for a fresh invite.")
      return
    }
    if (!interest.trim() || !city.trim()) {
      setError('Please fill in your interests and city.')
      return
    }

    setSubmitting(true)
    try {
      const profile: UserProfile = {
        email,
        linkedin,
        interest: interest.trim(),
        location: city.trim(),
        frequency,
        learn: learn || '',
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
        {submitted ? (
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
              This page lets {learn || 'Whispered'} users sign up in seconds
              for free.
            </p>
            <p
              className="mt-3 mb-0"
              style={{ fontSize: 15.5, color: 'var(--ink-2)', lineHeight: 1.6 }}
            >
              Whispered Events curates the best in-person dinners, conferences,
              and gatherings for senior operators and execs — the ones that
              aren&apos;t widely posted. We match them to your role, location,
              and interests.
            </p>

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
                We already have your function and level attached to{' '}
                <strong style={{ color: 'var(--ink)' }}>{email || 'your email'}</strong>.
                Share the three below and we&apos;ll create your free
                Whispered Events account.
              </p>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              <Field label="What types of events are you interested in?" hint="Add keywords to sharpen your matches — specific beats generic. Works well: Sales, AI, GTM, Marketing. Too broad: networking, dinners.">
                <textarea
                  value={interest}
                  onChange={(e) => setInterest(e.target.value)}
                  placeholder="e.g. RevOps, GTM, AI, SaaS leadership"
                  rows={3}
                  className={inputCls}
                  required
                />
              </Field>

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
                  disabled={submitting || !hasEmail}
                  className="px-6 py-2.5 rounded-pill text-[14px] font-medium text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ background: 'var(--accent)' }}
                  onMouseEnter={(e) => !submitting && hasEmail && (e.currentTarget.style.background = 'var(--accent-2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
                >
                  {submitting ? 'Submitting…' : 'Create my account'}
                </button>
              </div>

              {!hasEmail && (
                <p className="mt-2" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  Your invite link is missing the email. Please ask for a fresh link.
                </p>
              )}
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
  children,
}: {
  label: string
  hint?: string
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
      {hint && (
        <span
          className="block mb-2"
          style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}
        >
          {hint}
        </span>
      )}
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-input border border-rule bg-white px-3 py-2 text-[14px] text-ink placeholder:opacity-60 focus:outline-none focus:border-accent transition-colors'
