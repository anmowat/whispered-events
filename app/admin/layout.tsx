import type { Metadata } from 'next'

export const metadata: Metadata = {
  icons: {
    icon: '/w-olive-gold.svg',
    apple: '/w-olive-gold.svg',
  },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
