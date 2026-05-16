import { ImageResponse } from 'next/og'

// Next.js auto-discovers this file and wires it as both the og:image
// and twitter:image for the root route. 1200×630 is the canonical
// social-card size — LinkedIn, X, Facebook, Slack all crop from this
// aspect ratio.
//
// Notes on the layout:
// - Uses Satori's built-in default font, which renders considerably
//   wider than a typical webfont; sizes are chosen so each line fits
//   on one row in a 1200px canvas with 80px side padding.
// - Stacks naturally with marginTop spacers rather than flex:1 on the
//   middle column. flex:1 made an overflow vertically-compress all
//   children into each other when the content was too tall.

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
          padding: '64px 80px',
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
          <div style={{ display: 'flex', fontSize: 40, lineHeight: 1 }}>
            <span style={{ color: C.inkMuted, marginRight: 10 }}>Whispered</span>
            <span style={{ color: C.ink }}>Events</span>
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            display: 'flex',
            fontSize: 60,
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            marginTop: 80,
          }}
        >
          The best events aren&apos;t posted.
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 104,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            fontStyle: 'italic',
            marginTop: 8,
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
            marginTop: 36,
          }}
        />

        {/* Subtext */}
        <div
          style={{
            display: 'flex',
            fontSize: 38,
            lineHeight: 1.3,
            fontStyle: 'italic',
            color: C.ink2,
            marginTop: 28,
          }}
        >
          Share and discover exclusive events.
        </div>
      </div>
    ),
    size,
  )
}
