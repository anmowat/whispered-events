/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og'

// Next.js auto-discovers this file and wires it as both the og:image
// and twitter:image for the root route. 1200×630 is the canonical
// social-card size — LinkedIn, X, Facebook, Slack all crop from this
// aspect ratio.

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

// Realistic desktop Chrome UA — Google Fonts uses UA sniffing to decide
// which format to return; older / generic UAs sometimes get ttf or
// nothing at all, and Satori rejects ttf.
const FONT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Fetches a single weight/style of a Google Font as an ArrayBuffer.
// Non-fatal: returns null on any failure so the OG image still renders
// with Satori's default font instead of 500'ing the route.
async function tryLoadGoogleFont(
  family: string,
  style: 'normal' | 'italic',
): Promise<ArrayBuffer | null> {
  try {
    const italMarker = style === 'italic' ? 'ital,wght@1,400' : 'wght@400'
    const cssUrl = `https://fonts.googleapis.com/css2?family=${family.replace(
      / /g,
      '+',
    )}:${italMarker}&display=swap`
    const css = await fetch(cssUrl, { headers: { 'User-Agent': FONT_UA } }).then(
      (r) => r.text(),
    )
    const match = css.match(/src:\s*url\((https:[^)]+\.woff2)\)/)
    if (!match) {
      console.error(
        `opengraph-image: no woff2 URL found in Google Fonts CSS for ${family} ${style}. CSS body:`,
        css.slice(0, 500),
      )
      return null
    }
    return await fetch(match[1]).then((r) => r.arrayBuffer())
  } catch (e) {
    console.error(`opengraph-image: font fetch failed for ${family} ${style}:`, e)
    return null
  }
}

export default async function OpenGraphImage() {
  const [instrumentRegular, instrumentItalic, newsreader] = await Promise.all([
    tryLoadGoogleFont('Instrument Serif', 'normal'),
    tryLoadGoogleFont('Instrument Serif', 'italic'),
    tryLoadGoogleFont('Newsreader', 'normal'),
  ])

  type FontEntry = {
    name: string
    data: ArrayBuffer
    style: 'normal' | 'italic'
    weight: 400 | 500
  }
  const fonts: FontEntry[] = []
  if (instrumentRegular) {
    fonts.push({
      name: 'Instrument Serif',
      data: instrumentRegular,
      style: 'normal',
      weight: 400,
    })
  }
  if (instrumentItalic) {
    fonts.push({
      name: 'Instrument Serif',
      data: instrumentItalic,
      style: 'italic',
      weight: 400,
    })
  }
  if (newsreader) {
    fonts.push({
      name: 'Newsreader',
      data: newsreader,
      style: 'normal',
      weight: 500,
    })
  }

  // Pick a sensible display family for each role based on what loaded.
  // If the brand fonts failed to load we fall back to Satori's default
  // and the layout still renders.
  const serifFamily = instrumentRegular ? 'Instrument Serif' : 'serif'
  const wordmarkFamily = newsreader
    ? 'Newsreader'
    : instrumentRegular
      ? 'Instrument Serif'
      : 'serif'

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
              fontFamily: wordmarkFamily,
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
              fontFamily: serifFamily,
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
              <span style={{ fontStyle: 'italic' }}>in person.</span>
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
              fontFamily: serifFamily,
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

        {/* Footer row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 16,
            borderTop: `1px solid ${C.rule}`,
            fontFamily: wordmarkFamily,
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
      fonts: fonts.length > 0 ? fonts : undefined,
    },
  )
}
