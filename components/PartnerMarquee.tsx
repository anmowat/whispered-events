'use client'

import { Partner } from '@/lib/airtable'

interface PartnerMarqueeProps {
  partners: Partner[]
}

// Looping partner-logo marquee. Renders TRACK_COPIES identical rows
// inside an animated flex container, then translates left by exactly
// ONE row width (= 100% / TRACK_COPIES) per cycle. As long as the
// viewport never extends past (TRACK_COPIES − 1) row widths, the
// loop is visually seamless — when the animation snaps back from
// 100% to 0%, the content at every visible x-position is byte-
// identical to what it was at 100%.
//
// All copies are rendered with the SAME structure (one outer div per
// copy) so the row widths don't drift. TRACK_COPIES is overprovisioned
// to cover ultra-wide displays without needing a resize observer or
// dynamic keyframes — both of which were causing visible hiccups.
const ITEM_GAP = 56
const TRACK_COPIES = 8
const CYCLE_SECONDS = 24 // time to scroll one row width

export default function PartnerMarquee({ partners }: PartnerMarqueeProps) {
  const featured = partners.filter((p) => p.featured)
  if (!featured.length) return null

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
        {Array.from({ length: TRACK_COPIES }).map((_, copyIdx) => (
          <div key={copyIdx} className="flex shrink-0" aria-hidden={copyIdx > 0}>
            {featured.map((p, i) => (
              <a
                key={i}
                href={p.website || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 flex items-center justify-center h-10 opacity-75 hover:opacity-100 transition-opacity"
                aria-label={copyIdx === 0 ? p.name : undefined}
                style={{ marginRight: ITEM_GAP }}
                tabIndex={copyIdx === 0 ? 0 : -1}
              >
                <img
                  src={p.logoUrl}
                  alt={p.name}
                  className="h-full w-auto object-contain max-w-[140px]"
                />
              </a>
            ))}
          </div>
        ))}
      </div>
      <style jsx>{`
        .marquee-track {
          animation: partner-marquee-loop ${CYCLE_SECONDS}s linear infinite;
        }
        @keyframes partner-marquee-loop {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(${-100 / TRACK_COPIES}%, 0, 0);
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
