const UTM = 'utm_source=whisperedevents.com'

// Appends ?utm_source=whisperedevents.com to any event URL shown to users.
// Handles URLs that already contain a query string (uses & instead of ?).
// Returns the original value unchanged if it's falsy or not an http(s) URL.
export function withUtm(url: string | null | undefined): string {
  if (!url) return url ?? ''
  if (!url.startsWith('http://') && !url.startsWith('https://')) return url
  return url.includes('?') ? `${url}&${UTM}` : `${url}?${UTM}`
}

// Cache-busts a Supabase Storage public URL after a re-upload.
//
// Upload keys are deterministic (`offer-banner-<id>.png` and friends) and use
// upsert, so replacing an image overwrites the same object and getPublicUrl
// returns a byte-identical URL. Nothing downstream can tell the file changed:
// the admin preview, the browser cache and Supabase's CDN all keep serving the
// previous image, so a successful upload looks like it silently did nothing.
//
// A version stamp makes each upload a distinct URL. The query string is part of
// the CDN cache key, so this busts every layer at once — and unlike giving each
// upload its own storage key, it doesn't orphan the old object every time.
export function withVersion(url: string): string {
  if (!url) return url
  return `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`
}
