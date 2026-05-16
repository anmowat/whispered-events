/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og'

// Next.js auto-discovers this file and wires it as both the og:image
// and twitter:image for the root route. 1200×630 is the canonical
// social-card size — LinkedIn, Twitter/X, Facebook, Slack all crop
// from this aspect ratio.

export const runtime = 'edge'
export const alt =
  "Whispered Events — Real relationships are built in person. The best events aren't posted, they're whispered."
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Salon palette inlined; Satori can't reach CSS variables.
const C = {
  bg: '#F1ECE2',
  inkMuted: 'rgba(0,0,0,0.30)',
  ink: '#1B1814',
  ink2: '#4A433B',
  ink3: '#8A8276',
  rule: '#DDD3C0',
  accent: '#6E1F2B',
}

// Fetches a single weight/style of a Google Font as an ArrayBuffer.
// Uses the css2 endpoint with a desktop User-Agent so Google returns
// the woff2 variant (the default UA returns ttf which Satori chokes on).
async function loadGoogleFont(
  family: string,
  style: 'normal' | 'italic',
): Promise<ArrayBuffer> {
  const italMarker = style === 'italic' ? 'ital,wght@1,400' : 'wght@400'
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:${italMarker}&display=swap`,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    },
  ).then((r) => r.text())
  const match = css.match(/src:\s*url\((https:[^)]+\.woff2)\)/)
  if (!match) throw new Error(`Could not extract woff2 url for ${family} ${style}`)
  const fontBuf = await fetch(match[1]).then((r) => r.arrayBuffer())
  return fontBuf
}

export default async function OpenGraphImage() {
  const [instrumentRegular, instrumentItalic, newsreader] = await Promise.all([
    loadGoogleFont('Instrument Serif', 'normal'),
    loadGoogleFont('Instrument Serif', 'italic'),
    loadGoogleFont('Newsreader', 'normal'),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: C.bg,
          display: 'flex',
          flexDirection: 'column',
          padding: '64px 72px',
          position: 'relative',
        }}
      >
        {/* Wordmark + pulse-dot anchor */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: 999,
              background: C.accent,
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 9,
              lineHeight: 1,
              fontFamily: 'Newsreader',
              fontWeight: 500,
              fontSize: 38,
              letterSpacing: '-0.012em',
            }}
          >
            <span style={{ color: C.inkMuted }}>Whispered</span>
            <span style={{ color: C.ink }}>Events</span>
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
            paddingTop: 24,
            paddingBottom: 24,
          }}
        >
          <div
            style={{
              fontFamily: 'Instrument Serif',
              fontSize: 96,
              lineHeight: 1.02,
              letterSpacing: '-0.01em',
              color: C.ink,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span>Real relationships are</span>
            <span>
              built{' '}
              <span style={{ fontStyle: 'italic', fontFamily: 'Instrument Serif Italic' }}>
                in person.
              </span>
            </span>
          </div>

          {/* Oxblood hairline */}
          <div
            style={{
              width: 96,
              height: 2,
              background: C.accent,
              marginTop: 28,
              marginBottom: 24,
            }}
          />

          <div
            style={{
              fontFamily: 'Instrument Serif Italic',
              fontStyle: 'italic',
              fontSize: 36,
              lineHeight: 1.25,
              color: C.ink2,
              maxWidth: 880,
            }}
          >
            The best events aren&apos;t posted — they&apos;re whispered.
          </div>
        </div>

        {/* Footer row: bottom-left est, bottom-right URL */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 16,
            borderTop: `1px solid ${C.rule}`,
            fontFamily: 'Newsreader',
            fontSize: 18,
            color: C.ink3,
          }}
        >
          <span style={{ fontStyle: 'italic' }}>est. 2026 · for executives</span>
          <span style={{ color: C.accent, fontWeight: 500 }}>
            whisperedevents.com
          </span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Newsreader', data: newsreader, style: 'normal', weight: 500 },
        {
          name: 'Instrument Serif',
          data: instrumentRegular,
          style: 'normal',
          weight: 400,
        },
        {
          name: 'Instrument Serif Italic',
          data: instrumentItalic,
          style: 'italic',
          weight: 400,
        },
      ],
    },
  )
}
