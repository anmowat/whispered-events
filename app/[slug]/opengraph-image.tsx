import { ImageResponse } from 'next/og'
import { getAnchorEventBySlug } from '@/lib/anchor-events'

export const runtime = 'nodejs'
export const alt = 'Whispered Events side event guide'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const C = {
  bg: '#1b1814',
  card: '#22201c',
  ink: '#ece6da',
  inkMuted: 'rgba(236,230,218,0.55)',
  accent: '#c9a86a',
  rule: 'rgba(236,230,218,0.12)',
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const mime = res.headers.get('content-type') ?? 'image/png'
    return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
}

export default async function AnchorEventOGImage({
  params,
}: {
  params: { slug: string }
}) {
  const anchorEvent = await getAnchorEventBySlug(params.slug).catch(() => null)

  const title = anchorEvent?.title || 'Whispered Side Events'
  const anchorName = anchorEvent?.anchorName || ''
  const description = anchorEvent?.description || 'See all the whispered events →'

  const iconSrc = anchorEvent?.anchorIconUrl
    ? await toDataUrl(anchorEvent.anchorIconUrl)
    : null

  // Whispered wordmark
  const lockupSrc = await toDataUrl('https://www.whisperedevents.com/lockup-horizontal-gold.svg')

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: C.bg,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px 72px',
        }}
      >
        {/* Top: Whispered wordmark */}
        {lockupSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lockupSrc} alt="Whispered Events" style={{ height: 44, objectFit: 'contain', objectPosition: 'left' }} />
        )}

        {/* Middle: main content row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 64, flex: 1, marginTop: 48 }}>
          {/* Left text block */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            {/* Event name tag */}
            {anchorName && (
              <div style={{
                display: 'flex',
                fontSize: 22,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: C.accent,
                marginBottom: 24,
                fontWeight: 600,
              }}>
                {anchorName}
              </div>
            )}

            {/* Title */}
            <div style={{
              display: 'flex',
              fontSize: title.length > 28 ? 72 : 86,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              color: C.ink,
              marginBottom: 28,
            }}>
              {title}
            </div>

            {/* Divider */}
            <div style={{ width: 64, height: 3, background: C.accent, marginBottom: 28, opacity: 0.7 }} />

            {/* Description / tagline */}
            <div style={{
              display: 'flex',
              fontSize: 28,
              color: C.inkMuted,
              lineHeight: 1.4,
            }}>
              {description || 'See all the whispered events →'}
            </div>
          </div>

          {/* Right: anchor icon */}
          {iconSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={iconSrc}
              alt={anchorName}
              style={{
                width: 240,
                height: 240,
                objectFit: 'contain',
                borderRadius: 36,
                flexShrink: 0,
              }}
            />
          )}
        </div>
      </div>
    ),
    size,
  )
}
