import { cache } from 'react'
import { getAnchorEventBySlug, getAnchorEventEvents } from '@/lib/anchor-events'
import { buildAnchorEventGraph } from '@/lib/seo/schema'
import JsonLd from '@/components/seo/JsonLd'
import type { Metadata } from 'next'

// generateMetadata and the layout body both need the anchor event. The Supabase
// client sets `cache: 'no-store'`, so Next's fetch dedupe doesn't apply and we'd
// otherwise issue the same query twice per request.
const loadAnchorEvent = cache((slug: string) => getAnchorEventBySlug(slug).catch(() => null))

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const ev = await loadAnchorEvent(slug)
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

// The page itself is a client component that fetches its data after hydration,
// so its markup is invisible to crawlers that don't run JavaScript. Emitting the
// structured data here — in a server component — is what actually gets the event
// list in front of AI answer engines.
export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const ev = await loadAnchorEvent(slug)
  const events = ev?.status === 'live' ? await getAnchorEventEvents(ev.id).catch(() => []) : []

  return (
    <>
      {ev && ev.status === 'live' && (
        <JsonLd
          data={buildAnchorEventGraph({
            title: ev.title,
            description: ev.description,
            slug: ev.slug,
            events: events.map((e) => ({
              id: e.id,
              name: e.name,
              date: e.date,
              location: e.location,
              description: e.description,
              link: e.link,
              organizer: e.organizer,
              startTime: e.startTime,
              endTime: e.endTime,
            })),
          })}
        />
      )}
      {children}
    </>
  )
}
