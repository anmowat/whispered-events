import type { MetadataRoute } from 'next'
import { listAnchorEvents } from '@/lib/anchor-events'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const events = await listAnchorEvents().catch(() => [])
  const liveEvents = events.filter((e) => e.status === 'live')

  return [
    {
      url: 'https://www.whisperedevents.com',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...liveEvents.map((e) => ({
      url: `https://www.whisperedevents.com/${e.slug}`,
      lastModified: new Date(e.updatedAt),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
  ]
}
