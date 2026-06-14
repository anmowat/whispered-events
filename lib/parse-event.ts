import { scrapeUrl } from './scraper'
import { parseEventContent } from './claude'
import { ParsedEvent } from './types'

export function isUrl(input: string): boolean {
  try {
    new URL(input)
    return true
  } catch {
    return false
  }
}

export async function parseEventInput(
  input: string
): Promise<{ parsed: ParsedEvent; isUrl: boolean }> {
  const inputIsUrl = isUrl(input)
  let content = input
  let imageUrl: string | undefined
  if (inputIsUrl) {
    try {
      const scrape = await scrapeUrl(input)
      content = scrape.text
      imageUrl = scrape.imageUrl
    } catch (err) {
      console.error('parseEventInput scrape failed:', err instanceof Error ? err.message : String(err))
      content = `Event URL: ${input}`
    }
  }
  const parsed = await parseEventContent(content, inputIsUrl ? input : undefined)
  if (imageUrl) parsed.image = imageUrl
  return { parsed, isUrl: inputIsUrl }
}
