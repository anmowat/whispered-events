import type { Metadata } from 'next'

// Auth-gated host console — nothing here is useful in search results, and it
// would otherwise inherit `canonical: '/'` from the root layout.
export const metadata: Metadata = {
  title: 'Host | Whispered Events',
  robots: { index: false, follow: false },
  alternates: { canonical: '/host' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
