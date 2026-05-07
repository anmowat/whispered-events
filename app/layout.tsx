import type { Metadata } from 'next'
import './globals.css'

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
    <html lang="en">
      <body className="min-h-screen bg-[#F5EFE6] text-gray-900 antialiased">
        {children}
      </body>
    </html>
  )
}
