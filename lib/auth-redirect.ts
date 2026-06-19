// Allow-list for the magic-link auth flow's post-verify destination.
// `next` rides through /api/auth/magic-link → email URL → /auth/login
// hidden form input → /api/auth/verify, so any path on this list can be
// the user's actual landing page. Limiting to known internal routes
// keeps the parameter from being an open-redirect vector — even a
// tampered email URL can only bounce the user between our own pages.
const NEXT_ALLOWLIST = new Set(['/dashboard', '/host'])

export function safeNext(next: string | null | undefined): string {
  if (!next) return '/dashboard'
  return NEXT_ALLOWLIST.has(next) ? next : '/dashboard'
}
