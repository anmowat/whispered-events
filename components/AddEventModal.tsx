'use client'

import { useState } from 'react'

function CopyIcon() {
  return (
    <svg aria-hidden width="11" height="11" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 9V3a1 1 0 0 1 1-1h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export default function AddEventModal({
  onClose,
  onShareOnSite,
}: {
  onClose: () => void
  onShareOnSite?: () => void
}) {
  const email = 'event@whispered.com'
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard may be blocked in insecure contexts — user can still select the address.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,15,10,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-card border p-6"
        style={{ background: '#252220', borderColor: 'rgba(236,230,218,.13)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2
            className="font-serif m-0"
            style={{ fontSize: 24, color: '#ece6da', letterSpacing: '-0.01em' }}
          >
            Add an{' '}
            <span style={{ fontStyle: 'italic', color: '#c9a86a' }}>event</span>{' '}
            (anonymously) in seconds
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none"
            style={{ color: 'rgba(236,230,218,.5)' }}
          >
            &times;
          </button>
        </div>
        <div
          className="m-0 mb-4 text-center space-y-1.5"
          style={{ fontSize: 15, color: 'rgba(236,230,218,.78)', lineHeight: 1.55 }}
        >
          <p className="m-0">Share a link to any event</p>
          <p className="m-0">(one you&rsquo;re running or one you know about)</p>
          <p className="m-0">Our AI extracts the details</p>
          <p className="m-0">We share the event with the execs whose profile fits</p>
          <p className="m-0">You get karma and credits 🥂</p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-2 rounded-pill text-[15px] font-medium text-center py-3 border transition-colors"
            style={{
              borderColor: 'rgba(236,230,218,.28)',
              color: copied ? '#c9a86a' : '#ece6da',
              background: 'transparent',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#c9a86a'
              e.currentTarget.style.color = '#c9a86a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(236,230,218,.28)'
              e.currentTarget.style.color = copied ? '#c9a86a' : '#ece6da'
            }}
            aria-label={`Copy ${email} to clipboard`}
          >
            {copied ? `${email} (copied!)` : `Email ${email}`}
            <CopyIcon />
          </button>
          {onShareOnSite && (
            <button
              type="button"
              onClick={onShareOnSite}
              className="rounded-pill text-[15px] font-medium text-center py-3 border transition-colors"
              style={{
                borderColor: 'rgba(236,230,218,.28)',
                color: '#ece6da',
                background: 'transparent',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#c9a86a'
                e.currentTarget.style.color = '#c9a86a'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(236,230,218,.28)'
                e.currentTarget.style.color = '#ece6da'
              }}
            >
              Share on site
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
