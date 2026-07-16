import type { Metadata } from 'next'
import {
  Inter,
  Instrument_Serif,
  Newsreader,
  Cormorant_Garamond,
  Hanken_Grotesk,
  Poppins,
  Playfair_Display,
} from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

// Fonts loaded as CSS variables so Tailwind's font-{family} utilities +
// raw inline styles can both reach them.
//   --font-geist             body / UI (sans) — Inter substitutes for Geist
//                            since Next 14.2.5's next/font/google catalog
//                            doesn't include Geist.
//   --font-instrument-serif  display / headlines / italic emphasis (Salon)
//   --font-newsreader        Salon wordmark
//   --font-cormorant         After Hours display serif (homepage hero +
//                            wordmark + section numerals)
//   --font-hanken            After Hours body sans
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

const cormorantGaramond = Cormorant_Garamond({
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-cormorant',
  display: 'swap',
  adjustFontFallback: false,
})

const hankenGrotesk = Hanken_Grotesk({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
})

const poppins = Poppins({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-poppins',
  display: 'swap',
})

const playfairDisplay = Playfair_Display({
  weight: ['400'],
  style: ['italic'],
  subsets: ['latin'],
  variable: '--font-playfair-display',
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
    icon: '/favicon-512.png',
    apple: '/favicon-512.png',
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

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Whispered Events',
  url: 'https://www.whisperedevents.com',
  logo: 'https://www.whisperedevents.com/opengraph-image',
  description:
    "Whispered Events curates exclusive in-person dinners, conferences, and gatherings for senior operators and executives — the ones that aren't widely posted.",
  contactPoint: {
    '@type': 'ContactPoint',
    email: 'hello@whisperedevents.com',
    contactType: 'customer support',
  },
}

const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Whispered Events',
  url: 'https://www.whisperedevents.com',
  description:
    "The best events aren't posted — they're whispered. A private platform for executives to discover exclusive, invitation-only events.",
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: 'https://www.whisperedevents.com/?q={search_term_string}',
    },
    'query-input': 'required name=search_term_string',
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
      className={`${geist.variable} ${instrumentSerif.variable} ${newsreader.variable} ${cormorantGaramond.variable} ${hankenGrotesk.variable} ${poppins.variable} ${playfairDisplay.variable}`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
