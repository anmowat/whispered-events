import { ImageResponse } from 'next/og'

// Next.js auto-discovers this file and wires it as both the og:image
// and twitter:image for the root route. 2× rendered (2400×1260) so
// LinkedIn / X aggressive JPEG re-compression downsamples to a still-
// sharp preview thumbnail. Underlying aspect ratio is the canonical
// 1.91:1 social card.
//
// After Hours palette: warm near-black background, champagne accent,
// italic-champagne 'whispered' echoing the homepage hero.
//
// Every element with multiple direct children has display:flex —
// Satori's strict layout rules require it.

export const runtime = 'edge'
export const alt =
  "Whispered Events — The best events aren't posted. They're whispered."
export const size = { width: 2400, height: 1260 }
export const contentType = 'image/png'

const C = {
  bg: '#1b1814',
  ink: '#ece6da',
  inkMuted: 'rgba(236,230,218,0.6)',
  inkFaint: 'rgba(236,230,218,0.38)',
  accent: '#c9a86a',
  rule: 'rgba(236,230,218,0.16)',
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
        {/* Wordmark — diamond mark + ink Whispered + italic-champagne Events */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 28,
              height: 28,
              background: C.accent,
              transform: 'rotate(45deg)',
              marginRight: 36,
            }}
          />
          <div style={{ display: 'flex', fontSize: 80, lineHeight: 1, letterSpacing: '0.01em' }}>
            <span style={{ color: C.ink, marginRight: 20 }}>Whispered</span>
            <span style={{ color: C.accent, fontStyle: 'italic' }}>Events</span>
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            display: 'flex',
            fontSize: 128,
            lineHeight: 1.04,
            letterSpacing: '-0.01em',
            marginTop: 168,
            color: C.ink,
          }}
        >
          The best events aren&apos;t posted.
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 208,
            lineHeight: 1.02,
            letterSpacing: '-0.02em',
            fontStyle: 'italic',
            color: C.accent,
            marginTop: 16,
          }}
        >
          They&apos;re whispered.
        </div>

        {/* Hairline + subtext */}
        <div
          style={{
            width: 280,
            height: 4,
            background: C.accent,
            marginTop: 88,
            opacity: 0.7,
          }}
        />
        <div
          style={{
            display: 'flex',
            fontSize: 56,
            lineHeight: 1.3,
            color: C.inkMuted,
            marginTop: 56,
            letterSpacing: '-0.005em',
          }}
        >
          Share and discover exclusive events.
        </div>
      </div>
    ),
    size,
  )
}
