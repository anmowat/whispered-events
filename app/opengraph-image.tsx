import { ImageResponse } from 'next/og'

// Next.js auto-discovers this file and wires it as both the og:image
// and twitter:image for the root route. 2× rendered (2400×1260) so
// LinkedIn / X aggressive JPEG re-compression downsamples to a still-
// sharp preview thumbnail. Underlying aspect ratio is the canonical
// 1.91:1 social card.
//
// Every element with multiple direct children has display:flex —
// Satori's strict layout rules require it.

export const runtime = 'edge'
export const alt =
  "Whispered Events — The best events aren't posted. They're whispered."
export const size = { width: 2400, height: 1260 }
export const contentType = 'image/png'

const C = {
  bg: '#F1ECE2',
  inkMuted: 'rgba(0,0,0,0.30)',
  ink: '#1B1814',
  ink2: '#4A433B',
  accent: '#6E1F2B',
}

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: C.bg,
          display: 'flex',
          flexDirection: 'column',
          padding: '128px 160px',
          color: C.ink,
        }}
      >
        {/* Wordmark + pulse-dot anchor */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              background: C.accent,
              marginRight: 32,
            }}
          />
          <div style={{ display: 'flex', fontSize: 80, lineHeight: 1 }}>
            <span style={{ color: C.inkMuted, marginRight: 20 }}>Whispered</span>
            <span style={{ color: C.ink }}>Events</span>
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            display: 'flex',
            fontSize: 120,
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            marginTop: 160,
          }}
        >
          The best events aren&apos;t posted.
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 208,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            fontStyle: 'italic',
            marginTop: 16,
          }}
        >
          They&apos;re whispered.
        </div>

        {/* Oxblood hairline */}
        <div
          style={{
            width: 280,
            height: 8,
            background: C.accent,
            marginTop: 72,
          }}
        />

        {/* Subtext */}
        <div
          style={{
            display: 'flex',
            fontSize: 76,
            lineHeight: 1.3,
            fontStyle: 'italic',
            color: C.ink2,
            marginTop: 56,
          }}
        >
          Share and discover exclusive events.
        </div>
      </div>
    ),
    size,
  )
}
