'use client'

import { Suspense, useEffect, useState } from 'react'
import { withUtm } from '@/lib/url'
import { useSearchParams } from 'next/navigation'

const SERIF = `'Cormorant Garamond', Georgia, 'Times New Roman', serif`
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

export default function RateThanksPage() {
  return (
    <Suspense fallback={null}>
      <RateThanksContent />
    </Suspense>
  )
}

function RateThanksContent() {
  const searchParams = useSearchParams()
  const rating = searchParams.get('rating')
  const eventId = searchParams.get('eventId') ?? ''
  const error = searchParams.get('error')

  const [authState, setAuthState] = useState<'loading' | 'in' | 'out'>('loading')
  const [reason, setReason] = useState('')
  const [reasonSubmitting, setReasonSubmitting] = useState(false)
  const [reasonDone, setReasonDone] = useState(false)

  // For not-logged-in magic link flow
  const [magicEmail, setMagicEmail] = useState('')
  const [magicState, setMagicState] = useState<'idle' | 'sending' | 'sent'>('idle')

  // Event details for interested / not_a_fit pages
  const [event, setEvent] = useState<{ name: string; link: string | null } | null>(null)

  useEffect(() => {
    if (!eventId) return
    if (rating !== 'interested' && rating !== 'not_a_fit') return
    fetch(`/api/events/${encodeURIComponent(eventId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.event) setEvent(d.event) })
      .catch(() => {})
  }, [rating, eventId])

  useEffect(() => {
    if (rating !== 'not_a_fit') return
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { user: unknown }) => setAuthState(d.user ? 'in' : 'out'))
      .catch(() => setAuthState('out'))
  }, [rating])

  async function submitReason(e: React.FormEvent) {
    e.preventDefault()
    if (!eventId || !reason.trim()) return
    setReasonSubmitting(true)
    await fetch('/api/dashboard/match-rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, rating: 'not_a_fit', reason: reason.trim() }),
    })
    setReasonSubmitting(false)
    setReasonDone(true)
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    if (!magicEmail.trim()) return
    setMagicState('sending')
    await fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: magicEmail.trim(), next: '/dashboard' }),
    })
    setMagicState('sent')
  }

  const page: React.CSSProperties = {
    minHeight: '100vh',
    background: '#1b1814',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    fontFamily: SANS,
  }

  const card: React.CSSProperties = {
    background: '#251e19',
    border: '1px solid rgba(201,168,106,0.2)',
    borderRadius: 18,
    padding: '40px 36px',
    maxWidth: 440,
    width: '100%',
    textAlign: 'center',
  }

  const gold = '#c9a86a'
  const ink = '#ece6da'
  const muted = '#9c8b7e'

  // Error state (bad token etc.)
  if (error) {
    return (
      <div style={page}>
        <div style={card}>
          <div style={{ fontFamily: SERIF, fontSize: 30, color: ink, marginBottom: 12 }}>
            Link expired
          </div>
          <p style={{ color: muted, fontSize: 15, lineHeight: 1.6, margin: '0 0 24px' }}>
            This rating link has expired or is invalid. You can rate events directly from your dashboard.
          </p>
          <a
            href="/dashboard"
            style={{ display: 'inline-block', background: gold, color: '#1b1814', borderRadius: 99, padding: '11px 26px', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
          >
            Go to dashboard →
          </a>
        </div>
      </div>
    )
  }

  if (rating === 'interested') {
    return (
      <div style={page}>
        <div style={card}>
          <div style={{ fontFamily: SERIF, fontSize: 32, color: ink, marginBottom: 14, lineHeight: 1.1 }}>
            Thanks for the feedback
          </div>
          <p style={{ color: muted, fontSize: 15, lineHeight: 1.65, margin: '0 0 24px' }}>
            Your feedback helps us improve the matches we send.
          </p>

          {event && (
            <p style={{ color: muted, fontSize: 15, lineHeight: 1.65, margin: '0 0 24px' }}>
              If you haven&apos;t yet registered for{' '}
              {event.link ? (
                <a href={withUtm(event.link)} target="_blank" rel="noopener noreferrer" style={{ color: gold, textDecoration: 'none' }}>
                  {event.name}
                </a>
              ) : (
                <span style={{ color: ink }}>{event.name}</span>
              )}{' '}
              click to visit the host&apos;s site and register.
            </p>
          )}

          <div style={{ background: 'rgba(201,168,106,0.06)', border: '1px solid rgba(201,168,106,0.15)', borderRadius: 12, padding: '18px 20px', marginBottom: 24, textAlign: 'left' }}>
            <div style={{ color: gold, fontSize: 12, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 8 }}>
              Please note
            </div>
            <p style={{ color: muted, fontSize: 14, lineHeight: 1.65, margin: 0 }}>
              We collaborate with many hosts to make matches but each host decides who attends; we just point you to the right rooms and make the best matches we can.
            </p>
          </div>

          <p style={{ color: muted, fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
            Questions? Email our team at{' '}
            <a href="mailto:team@whisperedevents.com" style={{ color: gold, textDecoration: 'none' }}>
              team@whisperedevents.com
            </a>
          </p>

          <a href="/dashboard" style={{ color: gold, fontSize: 14, textDecoration: 'none' }}>
            Visit your dashboard to see all your matches
          </a>
        </div>
      </div>
    )
  }

  if (rating === 'not_a_fit') {
    return (
      <div style={page}>
        <div style={card}>
          <div style={{ fontSize: 40, marginBottom: 14, color: '#e05252' }}>✕</div>
          <div style={{ fontFamily: SERIF, fontSize: 32, color: ink, marginBottom: 12, lineHeight: 1.1 }}>
            Thanks for the feedback!
          </div>
          <p style={{ color: muted, fontSize: 15, lineHeight: 1.65, margin: '0 0 28px' }}>
            We&apos;ll hide this event and use your feedback (below) to improve your matches.
          </p>

          {authState === 'loading' && (
            <div style={{ color: muted, fontSize: 13 }}>Loading…</div>
          )}

          {authState === 'in' && !reasonDone && (
            <form onSubmit={submitReason} style={{ textAlign: 'left' }}>
              <label style={{ display: 'block', color: muted, fontSize: 12, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                Why wasn&apos;t it a fit? (optional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Wrong seniority, wrong topic, already seen it…"
                style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '10px 12px', color: ink, fontSize: 14, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: SANS }}
              />
              <button
                type="submit"
                disabled={reasonSubmitting || !reason.trim()}
                style={{ marginTop: 10, background: reason.trim() ? gold : 'rgba(201,168,106,0.3)', color: '#1b1814', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: reason.trim() ? 'pointer' : 'default', width: '100%' }}
              >
                {reasonSubmitting ? 'Submitting…' : 'Submit feedback'}
              </button>
            </form>
          )}

          {authState === 'in' && reasonDone && (
            <div style={{ color: gold, fontSize: 14, marginBottom: 16 }}>
              Thanks, noted!
            </div>
          )}

          {authState === 'out' && (
            <div style={{ textAlign: 'left' }}>
              <p style={{ color: muted, fontSize: 14, lineHeight: 1.6, margin: '0 0 18px' }}>
                Visit your dashboard to refine your profile and improve your matches — update your function, seniority, and interests to get better results.
              </p>
              {magicState === 'sent' ? (
                <div style={{ background: 'rgba(201,168,106,0.08)', border: '1px solid rgba(201,168,106,0.2)', borderRadius: 10, padding: '14px 16px', color: gold, fontSize: 14 }}>
                  Login link sent! Check your email to access your dashboard.
                </div>
              ) : (
                <form onSubmit={sendMagicLink}>
                  <label style={{ display: 'block', color: muted, fontSize: 12, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 8 }}>
                    Send me a login link
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="email"
                      value={magicEmail}
                      onChange={(e) => setMagicEmail(e.target.value)}
                      required
                      placeholder="your@email.com"
                      style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '10px 12px', color: ink, fontSize: 14, outline: 'none', fontFamily: SANS }}
                    />
                    <button
                      type="submit"
                      disabled={magicState === 'sending'}
                      style={{ background: gold, color: '#1b1814', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {magicState === 'sending' ? 'Sending…' : 'Send link →'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div style={{ marginTop: 28 }}>
            <a href="/dashboard" style={{ color: gold, fontSize: 14, textDecoration: 'none' }}>
              Visit your dashboard to see all your matches
            </a>
          </div>
        </div>
      </div>
    )
  }

  if (rating === 'hide') {
    return (
      <div style={page}>
        <div style={card}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>💙</div>
          <div style={{ fontFamily: SERIF, fontSize: 32, color: ink, marginBottom: 12, lineHeight: 1.1 }}>
            Noted!
          </div>
          <p style={{ color: muted, fontSize: 15, lineHeight: 1.65, margin: '0 0 24px' }}>
            Thanks for letting us know — we&apos;ll hide this event on your dashboard (you can still find it by adjusting the filter) but continue to show you similar events.
          </p>
          <p style={{ color: muted, fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
            Questions? Email our team at{' '}
            <a href="mailto:team@whisperedevents.com" style={{ color: gold, textDecoration: 'none' }}>
              team@whisperedevents.com
            </a>
          </p>
          <a href="/dashboard" style={{ color: gold, fontSize: 14, textDecoration: 'none' }}>
            Visit your dashboard to see all your matches
          </a>
        </div>
      </div>
    )
  }

  // Fallback
  return (
    <div style={page}>
      <div style={card}>
        <div style={{ fontFamily: SERIF, fontSize: 30, color: ink, marginBottom: 12 }}>
          Thanks for your feedback!
        </div>
        <a href="/dashboard" style={{ color: muted, fontSize: 13, textDecoration: 'none' }}>
          ← Back to dashboard
        </a>
      </div>
    </div>
  )
}
