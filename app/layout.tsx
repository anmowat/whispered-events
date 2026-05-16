import type { Metadata } from 'next'
import { Inter, Instrument_Serif, Newsreader } from 'next/font/google'
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
  description: 'Exclusive events, curated for executives.',
  alternates: {
    canonical: '/',
  },
  icons: {
    icon: '/favicon.svg',
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
      </body>
    </html>
  )
}
