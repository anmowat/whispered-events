'use client'

import { Partner } from '@/lib/airtable'

interface PartnerMarqueeProps {
  partners: Partner[]
}

// Classic two-track CSS marquee. Each "track" is COPIES_PER_TRACK
// duplicates of the partner row stitched into one flex strip; we
// render TWO identical tracks and translate -50% per cycle. Because
// -50% is exactly one track width (not a fractional percentage), the
// snap back to 0% lands on byte-identical content at every visible
// x-position — no sub-pixel drift, no visible reset.
//
// COPIES_PER_TRACK = 4 gives a track wide enough to span ultra-wide
// viewports even with a sparse partner list.
const ITEM_GAP = 56
const COPIES_PER_TRACK = 4
// Time to scroll one row width. 18s = 33% faster than the prior 24s.
const SECONDS_PER_ROW = 18

export default function PartnerMarquee({ partners }: PartnerMarqueeProps) {
  const featured = partners.filter((p) => p.featured)
  if (!featured.length) return null

  // Total per-cycle duration = (one track = COPIES_PER_TRACK rows) × per-row time.
  const cycleSeconds = COPIES_PER_TRACK * SECONDS_PER_ROW

  // Build one flat list of links per track. flatMap so React keys stay
  // unique across the duplicated copies.
  const track = (trackIdx: number) =>
    Array.from({ length: COPIES_PER_TRACK }).flatMap((_, copyIdx) =>
      featured.map((p, i) => (
        <a
          key={`${trackIdx}-${copyIdx}-${i}`}
          href={p.website || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center justify-center h-10 opacity-75 hover:opacity-100 transition-opacity"
          aria-label={trackIdx === 0 && copyIdx === 0 ? p.name : undefined}
          tabIndex={trackIdx === 0 && copyIdx === 0 ? 0 : -1}
          style={{ marginRight: ITEM_GAP }}
        >
          <img
            src={p.logoUrl}
            alt={p.name}
            className="h-full w-auto object-contain max-w-[140px]"
          />
        </a>
      )),
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
      <div className="flex whitespace-nowrap will-change-transform marquee-track">
        <div className="flex shrink-0">{track(0)}</div>
        <div className="flex shrink-0" aria-hidden>
          {track(1)}
        </div>
      </div>
      <style jsx>{`
        .marquee-track {
          animation: partner-marquee-loop ${cycleSeconds}s linear infinite;
        }
        @keyframes partner-marquee-loop {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(-50%, 0, 0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
