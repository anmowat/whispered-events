import { getAnchorEventBySlug } from '@/lib/anchor-events'
import type { Metadata } from 'next'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const ev = await getAnchorEventBySlug(slug).catch(() => null)
  if (!ev) return {}
  const url = `https://www.whisperedevents.com/${ev.slug}`
  return {
    title: `${ev.title} | Whispered Events`,
    description: ev.description,
    alternates: { canonical: url },
    openGraph: {
      title: ev.title,
      description: ev.description,
      url,
      siteName: 'Whispered Events',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: ev.title,
      description: ev.description,
    },
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
