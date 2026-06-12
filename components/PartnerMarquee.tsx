'use client'

import { Partner } from '@/lib/airtable'
import { useEffect, useRef, useState } from 'react'

interface PartnerMarqueeProps {
  partners: Partner[]
}

// Looping partner-logo marquee. We render N copies of the row inside an
// animated flex container, then translate left by exactly ONE row width
// (= 100% / N) per cycle. As long as the viewport never extends past
// (N-1) row widths, the loop is visually seamless — when the animation
// snaps back to 0, the content at every visible x-position is identical
// to what it was at 100%.
//
// N is computed at mount from `viewport / rowWidth` so a sparse partner
// list (few logos = narrow row) gets enough duplicates to cover wide
// screens without ever showing blank space.
const ITEM_GAP = 56
const MIN_COPIES = 3 // hard floor so the animation looks busy even on narrow screens
const CYCLE_SECONDS = 24 // base scroll speed of one row width (25% faster than the original 32s)
const MAX_COPIES = 12

export default function PartnerMarquee({ partners }: PartnerMarqueeProps) {
  const featured = partners.filter((p) => p.featured)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const [copies, setCopies] = useState(MIN_COPIES)

  // Re-measure after mount + on resize so the number of duplicated rows
  // always exceeds the viewport. We need rowWidth (one copy) and
  // wrapWidth (visible). Floor at MIN_COPIES so even huge rows still
  // animate.
  useEffect(() => {
    function measure() {
      const wrap = wrapRef.current
      const row = rowRef.current
      if (!wrap || !row) return
      const rowWidth = row.getBoundingClientRect().width
      const wrapWidth = wrap.getBoundingClientRect().width
      if (rowWidth === 0) return
      // Need enough copies that (N-1) row widths >= viewport, with a
      // safety margin of one extra row.
      const needed = Math.ceil(wrapWidth / rowWidth) + 2
      const next = Math.min(MAX_COPIES, Math.max(MIN_COPIES, needed))
      setCopies(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [featured.length])

  if (!featured.length) return null

  const Row = (
    <div className="flex shrink-0" aria-hidden>
      {featured.map((p, i) => (
        <a
          key={i}
          href={p.website || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center justify-center h-10 opacity-75 hover:opacity-100 transition-opacity"
          aria-label={p.name}
          style={{ marginRight: ITEM_GAP }}
        >
          <img
            src={p.logoUrl}
            alt={p.name}
            className="h-full w-auto object-contain max-w-[140px]"
          />
        </a>
      ))}
    </div>
  )

  // translate exactly one row width per cycle = -100% / copies.
  // Cycle duration scales with copies so per-row speed stays constant.
  const distance = 100 / copies
  const duration = CYCLE_SECONDS

  return (
    <div
      ref={wrapRef}
      className="partner-marquee relative overflow-hidden"
      style={{
        maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
        WebkitMaskImage:
          'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
      }}
    >
      <div
        className="flex whitespace-nowrap will-change-transform"
        style={{
          animation: `partner-marquee-shift ${duration}s linear infinite`,
          // Inline keyframes scoped per-instance so the translate
          // amount tracks the dynamic copy count.
        }}
      >
        {/* Real row carries the measurement ref. */}
        <div ref={rowRef} className="flex shrink-0">
          {featured.map((p, i) => (
            <a
              key={`primary-${i}`}
              href={p.website || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 flex items-center justify-center h-10 opacity-75 hover:opacity-100 transition-opacity"
              aria-label={p.name}
              style={{ marginRight: ITEM_GAP }}
            >
              <img
                src={p.logoUrl}
                alt={p.name}
                className="h-full w-auto object-contain max-w-[140px]"
              />
            </a>
          ))}
        </div>
        {Array.from({ length: copies - 1 }).map((_, i) => (
          <div key={`copy-${i}`}>{Row}</div>
        ))}
      </div>
      <style jsx>{`
        @keyframes partner-marquee-shift {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-${distance}%);
          }
        }
      `}</style>
    </div>
  )
}
