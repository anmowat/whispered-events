'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'we_buzz_dismissed_at'
const SUPPRESS_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export default function BuzzBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      const ts = localStorage.getItem(STORAGE_KEY)
      if (ts && Date.now() - Number(ts) < SUPPRESS_MS) return
    } catch {
      // localStorage blocked (private mode etc.) — just show the banner
    }
    setVisible(true)
  }, [])

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()))
    } catch {
      // ignore
    }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      style={{
        background: '#c9a86a',
        color: '#1b1814',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 40px 8px 16px',
        fontSize: 13,
        fontWeight: 500,
        lineHeight: 1.4,
        position: 'relative',
        letterSpacing: '.01em',
      }}
    >
      <span>
        Check out some of the{' '}
        <a
          href="/love"
          style={{ color: '#1b1814', fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 2 }}
          onClick={dismiss}
        >
          early buzz
        </a>
        {' '}on Whispered Events
      </span>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          position: 'absolute',
          right: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#1b1814',
          fontSize: 18,
          lineHeight: 1,
          padding: '2px 4px',
          opacity: 0.7,
        }}
      >
        ×
      </button>
    </div>
  )
}
