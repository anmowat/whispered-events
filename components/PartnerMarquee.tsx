import { Partner } from '@/lib/airtable'

interface PartnerMarqueeProps {
  partners: Partner[]
}

// Looping partner-logo marquee shown at the bottom of the landing.
// Track is duplicated so translating -50% loops seamlessly. Logos are
// the real ones from /api/partners (filtered to the Featured set);
// the fade mask is gradient-based so logos pre-roll into view rather
// than popping in at the edge.
export default function PartnerMarquee({ partners }: PartnerMarqueeProps) {
  const featured = partners.filter((p) => p.featured)
  if (!featured.length) return null
  const items = [...featured, ...featured]
  return (
    <div
      className="relative overflow-hidden"
      style={{
        maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
      }}
    >
      <div className="flex gap-14 animate-marquee whitespace-nowrap will-change-transform">
        {items.map((p, i) => (
          <a
            key={i}
            href={p.website || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 flex items-center justify-center h-10 opacity-75 hover:opacity-100 transition-opacity"
            aria-label={p.name}
          >
            <img
              src={p.logoUrl}
              alt={p.name}
              className="h-full w-auto object-contain max-w-[140px]"
            />
          </a>
        ))}
      </div>
    </div>
  )
}
