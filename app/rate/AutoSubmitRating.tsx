'use client'

import { useEffect, useRef, useState } from 'react'

const SERIF = `'Cormorant Garamond', Georgia, 'Times New Roman', serif`
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

// Submits the rating from the reader's browser on load, so a real click still
// costs zero extra taps. Mail-security scanners fetch the page but don't run
// scripts, which is exactly what keeps their traffic out of the ratings.
export default function AutoSubmitRating({
  token,
  rating,
  label,
}: {
  token: string
  rating: string
  label: string
}) {
  const [failed, setFailed] = useState(false)
  // StrictMode double-invokes effects in dev; the POST is idempotent but
  // there's no reason to send it twice.
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true

    if (!token || !rating) {
      window.location.replace('/rate/thanks?error=invalid')
      return
    }

    fetch('/api/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, rating }),
    })
      .then(async (res) => {
        if (res.status === 400) {
          window.location.replace('/rate/thanks?error=invalid')
          return
        }
        if (!res.ok) {
          setFailed(true)
          return
        }
        const data = (await res.json()) as { rating: string; eventId: string }
        window.location.replace(
          data.rating === 'skip'
            ? '/rate/thanks?rating=skip'
            : `/rate/thanks?rating=${data.rating}&eventId=${encodeURIComponent(data.eventId)}`,
        )
      })
      .catch(() => setFailed(true))
  }, [token, rating])

  const ink = '#ece6da'
  const muted = '#9c8b7e'

  return (
    <>
      <div style={{ fontFamily: SERIF, fontSize: 30, color: ink, marginBottom: 12, lineHeight: 1.15 }}>
        {failed ? 'Almost there' : 'Recording your rating…'}
      </div>
      <p style={{ color: muted, fontSize: 15, lineHeight: 1.6, margin: '0 0 24px' }}>
        {failed
          ? "We couldn't save your rating automatically. Tap below to confirm it."
          : 'One moment.'}
      </p>
      {/* Revealed only when the automatic submit fails, so a rating is never
          lost silently — the reader can always finish it by hand. */}
      {failed && (
        <form method="POST" action="/api/rate">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="rating" value={rating} />
          <button
            type="submit"
            style={{
              background: '#c9a86a',
              color: '#1b1814',
              borderRadius: 99,
              padding: '11px 26px',
              fontSize: 14,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              fontFamily: SANS,
            }}
          >
            Confirm &ldquo;{label}&rdquo;
          </button>
        </form>
      )}
    </>
  )
}
