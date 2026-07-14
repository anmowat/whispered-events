const UTM = 'utm_source=whisperedevents.com'

// Appends ?utm_source=whisperedevents.com to any event URL shown to users.
// Handles URLs that already contain a query string (uses & instead of ?).
// Returns the original value unchanged if it's falsy or not an http(s) URL.
export function withUtm(url: string | null | undefined): string {
  if (!url) return url ?? ''
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url
  return url.includes('?') ? `${url}&${UTM}` : `${url}?${UTM}`
}
