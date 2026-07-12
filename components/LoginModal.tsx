'use client'

import { useState } from 'react'

type State = 'idle' | 'loading' | 'sent' | 'not_found' | 'inactive' | 'error'

export default function LoginModal({
  onClose,
  next,
}: {
  onClose: () => void
  // Where to land the user after the magic-link round-trip. Passed
  // through to /api/auth/magic-link, validated server-side against
  // an allow-list. Defaults server-side to /dashboard.
  next?: string
}) {
  const [state, setState] = useState<State>('idle')
  const [email, setEmail] = useState('')

  async function handleSubmit() {
    if (!email.trim()) return
    setState('loading')
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), next }),
      })
      if (res.ok) {
        setState('sent')
        return
      }
      const data = (await res.json()) as { error: string }
      if (data.error === 'not_found') setState('not_found')
      else if (data.error === 'inactive') setState('inactive')
      else setState('error')
    } catch {
      setState('error')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,15,10,0.45)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[380px] rounded-card border p-7"
        style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <img src="/lockup-horizontal-gold.svg" alt="Whispered Events" style={{ height: 36 }} />
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none"
            style={{ color: 'var(--ink-3)' }}
          >
            &times;
          </button>
        </div>

        {state === 'idle' || state === 'loading' ? (
          <div className="space-y-4">
            <h2
              className="font-serif m-0"
              style={{
                fontSize: 26,
                lineHeight: 1.1,
                color: 'var(--ink)',
                letterSpacing: '-0.01em',
              }}
            >
              Let's connect you to great events
            </h2>

            {/* --- Existing member path --- */}
            <div
              className="rounded-card border p-4 space-y-3"
              style={{ borderColor: 'var(--rule)', background: 'var(--paper-2)' }}
            >
              <p className="m-0 font-medium" style={{ fontSize: 13, color: 'var(--ink)' }}>
                Already a member
              </p>
              <p className="m-0" style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>
                Enter your email and we&apos;ll send a one-time login link — no password needed.
              </p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit()
                }}
                placeholder="you@company.com"
                autoFocus
                className="w-full rounded-input border px-3.5 py-2.5 text-[14px] focus:outline-none transition-colors"
                style={{
                  background: 'var(--paper)',
                  borderColor: 'var(--rule)',
                  color: 'var(--ink)',
                }}
              />
              <button
                onClick={handleSubmit}
                disabled={state === 'loading' || !email.trim()}
                className="w-full py-2.5 rounded-pill text-[13px] font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'var(--accent)' }}
                onMouseEnter={(e) =>
                  state !== 'loading' &&
                  email.trim() &&
                  (e.currentTarget.style.background = 'var(--accent-2)')
                }
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
              >
                {state === 'loading' ? 'Sending…' : 'Send login link →'}
              </button>
            </div>

            {/* --- Divider --- */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: 'var(--rule)' }} />
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>or</span>
              <div className="flex-1 h-px" style={{ background: 'var(--rule)' }} />
            </div>

            {/* --- New user path --- */}
            <a
              href="/?apply=profile"
              className="block w-full py-2.5 rounded-pill text-[13px] font-medium text-center border transition-colors"
              style={{
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
                background: 'transparent',
                textDecoration: 'none',
              }}
            >
              New to Whispered Events? Create profile →
            </a>
          </div>
        ) : state === 'sent' ? (
          <div className="space-y-3 py-2">
            <h2
              className="font-serif m-0"
              style={{ fontSize: 24, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              Check your email.
            </h2>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              We sent a login link to <strong>{email}</strong>. It expires in 15 minutes.
            </p>
          </div>
        ) : state === 'not_found' ? (
          <div className="space-y-3">
            <h2
              className="font-serif m-0"
              style={{ fontSize: 24, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              Not in our system yet.
            </h2>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              No account found for <strong>{email}</strong>. Create a profile to apply for access — it only takes a minute.
            </p>
            <a
              href="/?apply=profile"
              className="block w-full py-2.5 rounded-pill text-[13px] font-medium text-white text-center"
              style={{ background: 'var(--accent)', textDecoration: 'none' }}
            >
              Create profile →
            </a>
            <button
              onClick={() => setState('idle')}
              className="w-full py-1.5 text-[12px]"
              style={{ color: 'var(--ink-3)' }}
            >
              ← Back
            </button>
          </div>
        ) : state === 'inactive' ? (
          <div className="space-y-3">
            <h2
              className="font-serif m-0"
              style={{ fontSize: 24, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              Account inactive.
            </h2>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              New profiles are reviewed manually — if you&apos;ve just applied, you&apos;ll
              hear from us soon. If your access has lapsed, contribute an event to
              reactivate.
            </p>
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-pill text-[13px] font-medium text-white"
              style={{ background: 'var(--accent)' }}
            >
              Got it
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p style={{ fontSize: 13.5, color: 'var(--ink)' }}>
              Something went wrong. Please try again.
            </p>
            <button
              onClick={() => setState('idle')}
              className="w-full py-2.5 rounded-pill text-[13px] font-medium text-white"
              style={{ background: 'var(--accent)' }}
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
