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
  if (inputIsUrl) {
    try {
      content = await scrapeUrl(input)
    } catch (err) {
      console.error('parseEventInput scrape failed:', err instanceof Error ? err.message : String(err))
      content = `Event URL: ${input}`
    }
  }
  const parsed = await parseEventContent(content, inputIsUrl ? input : undefined)
  return { parsed, isUrl: inputIsUrl }
}
