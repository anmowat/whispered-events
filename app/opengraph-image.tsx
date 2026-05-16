import { ImageResponse } from 'next/og'

// Next.js auto-discovers this file and wires it as both the og:image
// and twitter:image for the root route. 1200×630 is the canonical
// social-card size — LinkedIn, X, Facebook, Slack all crop from this
// aspect ratio.
//
// Uses Satori's built-in default font. Every element with multiple
// direct children has display:flex, which Satori's strict layout
// rules require.

export const runtime = 'edge'
export const alt =
  "Whispered Events — The best events aren't posted. They're whispered."
export const size = { width: 1200, height: 630 }
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
          padding: '60px 80px 80px',
          color: C.ink,
        }}
      >
        {/* Wordmark + pulse-dot anchor */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: C.accent,
              marginRight: 16,
            }}
          />
          <div style={{ display: 'flex', fontSize: 44, lineHeight: 1 }}>
            <span style={{ color: C.inkMuted, marginRight: 12 }}>Whispered</span>
            <span style={{ color: C.ink }}>Events</span>
          </div>
        </div>

        {/* Centered headline + subtext */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 78,
              lineHeight: 1.08,
              letterSpacing: '-0.01em',
            }}
          >
            The best events aren&apos;t posted.
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 132,
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              fontStyle: 'italic',
              marginTop: 6,
            }}
          >
            They&apos;re whispered.
          </div>

          {/* Oxblood hairline */}
          <div
            style={{
              width: 140,
              height: 4,
              background: C.accent,
              marginTop: 44,
              marginBottom: 32,
            }}
          />

          <div
            style={{
              display: 'flex',
              fontSize: 48,
              lineHeight: 1.3,
              fontStyle: 'italic',
              color: C.ink2,
            }}
          >
            Share and discover exclusive events.
          </div>
        </div>
      </div>
    ),
    size,
  )
}
