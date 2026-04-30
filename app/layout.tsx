import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Whispered Events',
  description: 'Exclusive events, curated for executives.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🤫</text></svg>",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0a0a14] text-gray-200 antialiased">
        {children}
      </body>
    </html>
  )
}
