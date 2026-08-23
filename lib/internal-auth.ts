import type { NextRequest } from 'next/server'
import { isAdmin } from './admin-auth'

// Auth for endpoints that are called two ways: from an admin's browser (session
// cookie) and server-to-server from our own route handlers (no cookie, because
// an internal fetch carries none).
//
// The shared secret is CRON_SECRET, already used by the cron routes and by
// lib/email-rating.ts. Both header spellings are accepted: the cron routes use
// `Authorization: Bearer`, and lib/enrich.ts was already sending `x-cron-secret`
// to /api/process-matches long before anything verified it.

export function internalSecretHeaders(): Record<string, string> {
  const secret = process.env.CRON_SECRET
  return secret ? { 'x-cron-secret': secret } : {}
}

function hasInternalSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (req.headers.get('x-cron-secret') === secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/**
 * True for a logged-in admin or a call carrying the internal secret.
 *
 * Fails closed: with CRON_SECRET unset, only an admin session passes, so a
 * missing env var can't silently leave the endpoint open.
 */
export async function isInternalOrAdmin(req: NextRequest): Promise<boolean> {
  if (hasInternalSecret(req)) return true
  return isAdmin(req)
}
