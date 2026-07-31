import type { Metadata } from 'next'

// Single-use action pages driven by a signed token. Nothing here belongs in
// search results, and without an explicit canonical these would inherit
// `canonical: '/'` from the root layout.
export const metadata: Metadata = {
  title: 'Rate an event | Whispered Events',
  robots: { index: false, follow: false },
  alternates: { canonical: '/rate' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
