import { ImageResponse } from 'next/og'

// Next.js auto-discovers this file and wires it as both the og:image
// and twitter:image for the root route. 1200×630 is the canonical
// social-card size — LinkedIn, X, Facebook, Slack all crop from this
// aspect ratio.
//
// Note on fonts: this version relies on ImageResponse's built-in
// default font. An earlier revision fetched Instrument Serif from
// Google Fonts at request time and broke (Satori choked silently on
// nested spans + the Edge fetch was flaky). Layout is Satori-safe:
// every element with multiple children has display:flex.

export const runtime = 'edge'
export const alt =
  "Whispered Events — Real relationships are built in person. The best events aren't posted, they're whispered."
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const C = {
  bg: '#F1ECE2',
  inkMuted: 'rgba(0,0,0,0.30)',
  ink: '#1B1814',
  ink2: '#4A433B',
  ink3: '#8A8276',
  rule: '#DDD3C0',
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
          justifyContent: 'space-between',
          padding: '64px 72px',
          color: C.ink,
        }}
      >
        {/* Wordmark + pulse-dot anchor */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: C.accent,
              marginRight: 14,
            }}
          />
          <div style={{ display: 'flex', fontSize: 38, lineHeight: 1 }}>
            <span style={{ color: C.inkMuted, marginRight: 10 }}>Whispered</span>
            <span style={{ color: C.ink }}>Events</span>
          </div>
        </div>

        {/* Headline column */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 96,
              lineHeight: 1.05,
              letterSpacing: '-0.01em',
            }}
          >
            Real relationships are
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 96,
              lineHeight: 1.05,
              letterSpacing: '-0.01em',
            }}
          >
            <span>built&nbsp;</span>
            <span style={{ fontStyle: 'italic' }}>in person.</span>
          </div>

          {/* Oxblood hairline */}
          <div
            style={{
              width: 96,
              height: 3,
              background: C.accent,
              marginTop: 32,
              marginBottom: 24,
            }}
          />

          <div
            style={{
              display: 'flex',
              fontSize: 34,
              lineHeight: 1.3,
              fontStyle: 'italic',
              color: C.ink2,
            }}
          >
            The best events aren&apos;t posted — they&apos;re whispered.
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 18,
            borderTop: `1px solid ${C.rule}`,
            fontSize: 18,
            color: C.ink3,
          }}
        >
          <span style={{ fontStyle: 'italic' }}>est. 2026 · for executives</span>
          <span style={{ color: C.accent }}>whisperedevents.com</span>
        </div>
      </div>
    ),
    size,
  )
}
