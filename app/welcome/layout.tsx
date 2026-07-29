import type { Metadata } from 'next'

// Personalized invite/onboarding flow driven by query params. Single-use and
// not meaningful out of context, so keep it out of the index — and off the
// root layout's inherited `canonical: '/'`.
export const metadata: Metadata = {
  title: 'Welcome | Whispered Events',
  robots: { index: false, follow: false },
  alternates: { canonical: '/welcome' },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
