import type { Metadata } from 'next'

// Without an explicit canonical here this page inherits `canonical: '/'` from
// the root layout, which tells Google it's a duplicate of the homepage.
export const metadata: Metadata = {
  title: 'What members say | Whispered Events',
  description:
    'What senior operators and executives say about the events they found through Whispered Events — in their own words.',
  alternates: { canonical: '/love' },
  openGraph: {
    title: 'What members say about Whispered Events',
    description:
      'What senior operators and executives say about the events they found through Whispered Events.',
    url: 'https://www.whisperedevents.com/love',
    siteName: 'Whispered Events',
    type: 'website',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
