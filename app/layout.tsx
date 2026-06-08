import type { Metadata } from 'next'
import { Inter, Instrument_Serif, Newsreader } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

// Three Google fonts loaded as CSS variables so Tailwind's font-{family}
// utilities + raw inline styles can both reach them.
//   --font-geist             body / UI (sans) — Inter substitutes for Geist
//                            since Next 14.2.5's next/font/google catalog
//                            doesn't include Geist. Visually close enough
//                            for the Salon brand; can swap to the
//                            standalone 'geist' npm package later.
//   --font-instrument-serif  display / headlines / italic emphasis
//   --font-newsreader        wordmark only
const geist = Inter({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})

const instrumentSerif = Instrument_Serif({
  weight: ['400'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-instrument-serif',
  display: 'swap',
  adjustFontFallback: false,
})

const newsreader = Newsreader({
  weight: ['500'],
  subsets: ['latin'],
  variable: '--font-newsreader',
  display: 'swap',
  adjustFontFallback: false,
})

export const metadata: Metadata = {
  metadataBase: new URL('https://www.whisperedevents.com'),
  title: 'Whispered Events',
  description:
    "Real relationships are built in person. The best events aren't posted — they're whispered. A private platform for executives to contribute and discover exclusive, invitation-only events.",
  alternates: {
    canonical: '/',
  },
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    siteName: 'Whispered Events',
    title: 'Whispered Events',
    description:
      "The best events aren't posted — they're whispered. A private platform for executives.",
    url: 'https://www.whisperedevents.com',
    // Absolute URLs (rather than relative paths resolved against
    // metadataBase) — LinkedIn's bot is most reliable when og:image
    // and og:image:secure_url are both fully-qualified. No query
    // param: an earlier ?v= cache-bust trick coincided with LinkedIn
    // failing to render the card at all, so this strips it back to
    // the most boring shape that scrapers expect.
    images: [
      {
        url: 'https://www.whisperedevents.com/opengraph-image',
        secureUrl: 'https://www.whisperedevents.com/opengraph-image',
        width: 2400,
        height: 1260,
        alt: "Whispered Events — The best events aren't posted. They're whispered.",
        type: 'image/png',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Whispered Events',
    description:
      "The best events aren't posted — they're whispered. A private platform for executives.",
    images: ['https://www.whisperedevents.com/opengraph-image'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${instrumentSerif.variable} ${newsreader.variable}`}
    >
      <body className="min-h-screen bg-bg text-ink antialiased font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
