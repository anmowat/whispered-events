'use client'

import { useState } from 'react'

const SERIF = `'Cormorant Garamond', Georgia, 'Times New Roman', serif`
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

// Submits only on a real tap.
//
// This deliberately does NOT submit on page load. Some corporate mail security
// opens links in a headless browser and executes page scripts, so anything that
// fires automatically gets triggered by the scanner too — which is exactly what
// happened when this auto-submitted. Requiring a genuine pointer/keyboard event
// is the part a link scanner doesn't reproduce.
export default function ConfirmRating({
  token,
  rating,
  label,
}: {
  token: string
  rating: string
  label: string
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle')

  async function submit(e: React.MouseEvent<HTMLButtonElement>) {
    // A scripted click reports isTrusted false. Cheap extra guard against an
    // automated opener that does drive the page.
    if (!e.isTrusted) return
    setState('saving')
    try {
      const res = await fetch('/api/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, rating }),
      })
      if (res.status === 400) {
        window.location.replace('/rate/thanks?error=invalid')
        return
      }
      if (!res.ok) {
        setState('failed')
        return
      }
      const data = (await res.json()) as { rating: string; eventId: string }
      window.location.replace(
        data.rating === 'skip'
          ? '/rate/thanks?rating=skip'
          : `/rate/thanks?rating=${data.rating}&eventId=${encodeURIComponent(data.eventId)}`,
      )
    } catch {
      setState('failed')
    }
  }

  const ink = '#ece6da'
  const muted = '#9c8b7e'

  return (
    <>
      <div style={{ fontFamily: SERIF, fontSize: 30, color: ink, marginBottom: 12, lineHeight: 1.15 }}>
        Confirm your rating
      </div>
      <p style={{ color: muted, fontSize: 15, lineHeight: 1.6, margin: '0 0 24px' }}>
        {state === 'failed'
          ? "That didn't go through. Tap again to retry."
          : `One tap to record “${label}”.`}
      </p>
      <button
        type="button"
        onClick={submit}
        disabled={state === 'saving'}
        style={{
          background: '#c9a86a',
          color: '#1b1814',
          borderRadius: 99,
          padding: '13px 30px',
          fontSize: 15,
          fontWeight: 600,
          border: 'none',
          cursor: state === 'saving' ? 'default' : 'pointer',
          fontFamily: SANS,
          opacity: state === 'saving' ? 0.6 : 1,
          width: '100%',
          maxWidth: 280,
        }}
      >
        {state === 'saving' ? 'Saving…' : label}
      </button>
    </>
  )
}
