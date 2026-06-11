import { Partner } from '@/lib/airtable'

interface PartnerMarqueeProps {
  partners: Partner[]
}

// Looping partner-logo marquee. Two identical tracks rendered side by side
// inside the animated container, with each logo carrying its own
// marginRight (= the inter-item gap). This makes one cycle width exactly
// equal to one track width, so the -50% translate loops seamlessly with
// no half-gap stutter on every cycle. (Flex `gap` produced a visible
// reset because the trailing gap and leading gap of the duplicated list
// were inconsistent.)
const ITEM_GAP = 56

export default function PartnerMarquee({ partners }: PartnerMarqueeProps) {
  const featured = partners.filter((p) => p.featured)
  if (!featured.length) return null

  const Row = (
    <div className="flex shrink-0">
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

  return (
    <div
      className="partner-marquee relative overflow-hidden"
      style={{
        maskImage: 'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
        WebkitMaskImage:
          'linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)',
      }}
    >
      <div className="flex animate-marquee whitespace-nowrap will-change-transform">
        {Row}
        {Row}
      </div>
    </div>
  )
}
