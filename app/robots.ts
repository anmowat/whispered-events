import type { MetadataRoute } from 'next'

// Paths that should never be indexed: admin surfaces, API responses, and
// authenticated or single-use pages that carry no value in search results.
const PRIVATE_PATHS = ['/admin', '/api/', '/dashboard', '/auth', '/rate']

// Crawlers that fetch pages in order to cite them in AI answers. These are the
// ones that matter for AEO — blocking them removes Whispered from the answers.
const AI_CITATION_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'Applebot',
  'meta-externalagent',
]

// Bulk training-corpus crawlers. They take content without sending a citation
// or a visitor back, so there's no upside in allowing them.
const TRAINING_ONLY_AGENTS = ['CCBot', 'Bytespider']

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE_PATHS },
      { userAgent: AI_CITATION_AGENTS, allow: '/', disallow: PRIVATE_PATHS },
      { userAgent: TRAINING_ONLY_AGENTS, disallow: '/' },
    ],
    sitemap: 'https://www.whisperedevents.com/sitemap.xml',
  }
}
