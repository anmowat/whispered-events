'use client'

import { Partner } from '@/lib/airtable'
import { useEffect, useRef, useState } from 'react'

interface PartnerMarqueeProps {
  partners: Partner[]
}

// Pixel-exact two-track marquee. We measure track 1 with a ref after
// all logo images have loaded, then animate translateX by exactly that
// many pixels. Using a measured pixel value (instead of -50% of the
// container) eliminates the sub-pixel rounding that was causing the
// snap from cycle-end back to cycle-start to look like a visible reset
// on certain viewport widths.
//
// The two tracks are STRUCTURALLY IDENTICAL — no aria-hidden on the
// container itself, same className, same children layout. Only DOM-
// only attributes (aria-label, tabIndex) on the inner links differ so
// the duplicate track stays out of the a11y tree without ever
// affecting rendered width.
const ITEM_GAP = 56
const COPIES_PER_TRACK = 4
const PIXELS_PER_SECOND = 33 // 33% faster than the prior 25 px/s

export default function PartnerMarquee({ partners }: PartnerMarqueeProps) {
  const featured = partners.filter((p) => p.featured)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [trackWidth, setTrackWidth] = useState(0)

  // Measure the rendered width of track 1 once images have loaded.
  // Sub-pixel widths land on getBoundingClientRect; we floor to an
  // integer so the keyframe end-value matches the second track's
  // starting position exactly.
  useEffect(() => {
    if (!featured.length || !trackRef.current) return
    const node = trackRef.current

    function measure() {
      if (!trackRef.current) return
      const w = Math.floor(trackRef.current.getBoundingClientRect().width)
      if (w > 0) setTrackWidth(w)
    }

    measure()

    const imgs = Array.from(node.querySelectorAll('img'))
    const remaining = imgs.filter((img) => !img.complete)
    if (remaining.length === 0) return

    const onLoad = () => {
      remaining.forEach((img) => img.removeEventListener('load', onLoad))
      remaining.forEach((img) => img.removeEventListener('error', onLoad))
      measure()
    }
    remaining.forEach((img) => {
      img.addEventListener('load', onLoad)
      img.addEventListener('error', onLoad)
    })
    return () => {
      remaining.forEach((img) => img.removeEventListener('load', onLoad))
      remaining.forEach((img) => img.removeEventListener('error', onLoad))
    }
  }, [featured.length])

  if (!featured.length) return null

  const cycleSeconds = trackWidth > 0 ? trackWidth / PIXELS_PER_SECOND : 0

  const items = Array.from({ length: COPIES_PER_TRACK }).flatMap((_, copyIdx) =>
    featured.map((p, i) => ({
      partner: p,
      copyIdx,
      i,
      key: `${copyIdx}-${i}`,
    })),
  )

  const link = (
    p: Partner,
    key: string,
    options: { interactive: boolean; labelled: boolean },
  ) => (
    <a
      key={key}
      href={p.website || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity"
      aria-label={options.labelled ? p.name : undefined}
      tabIndex={options.interactive ? 0 : -1}
      style={{
        marginRight: ITEM_GAP,
        background: '#F1ECE2',
        height: 44,
        padding: '0 16px',
        borderRadius: 5,
        border: '1px solid rgba(0,0,0,0.05)',
      }}
    >
      <img
        src={p.logoUrl}
        alt={p.name}
        className="h-7 w-auto object-contain max-w-[130px]"
      />
    </a>
  )

  return (
    <div
      className="partner-marquee relative overflow-hidden"
      style={{
        maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
        WebkitMaskImage:
          'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
      }}
    >
      <div
        className="flex whitespace-nowrap will-change-transform marquee-track"
        style={
          {
            // Once trackWidth is measured, kick off the animation. Until
            // then the track is rendered static at translateX(0).
            animation:
              cycleSeconds > 0
                ? `partner-marquee-loop ${cycleSeconds}s linear infinite`
                : 'none',
          } as React.CSSProperties
        }
      >
        <div ref={trackRef} className="flex shrink-0">
          {items.map(({ partner, copyIdx, key }) =>
            link(partner, `a-${key}`, {
              interactive: copyIdx === 0,
              labelled: copyIdx === 0,
            }),
          )}
        </div>
        <div className="flex shrink-0">
          {items.map(({ partner, key }) =>
            link(partner, `b-${key}`, { interactive: false, labelled: false }),
          )}
        </div>
      </div>
      <style jsx>{`
        @keyframes partner-marquee-loop {
          from {
            transform: translate3d(0, 0, 0);
          }
          to {
            transform: translate3d(-${trackWidth}px, 0, 0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}
