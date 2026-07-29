import type { MetadataRoute } from 'next'
import { listAnchorEvents } from '@/lib/anchor-events'

const SITE = 'https://www.whisperedevents.com'

// Public, indexable pages only. /dashboard, /auth/login and /rate/thanks are
// gated or single-use; /host is behind an auth check and /welcome is a
// personalized invite flow. Those are all marked noindex in their layouts and
// deliberately left out here.
const STATIC_PAGES: Array<{
  path: string
  priority: number
  changeFrequency: 'daily' | 'weekly' | 'monthly'
}> = [
  { path: '/faq', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/love', priority: 0.5, changeFrequency: 'monthly' },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const events = await listAnchorEvents().catch(() => [])
  const liveEvents = events.filter((e) => e.status === 'live')

  return [
    {
      url: SITE,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...STATIC_PAGES.map((p) => ({
      url: `${SITE}${p.path}`,
      changeFrequency: p.changeFrequency,
      priority: p.priority,
    })),
    ...liveEvents.map((e) => ({
      url: `${SITE}/${e.slug}`,
      lastModified: new Date(e.updatedAt),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
  ]
}
