import { createHmac } from 'crypto'

function getSecret(): string {
  const s = process.env.CRON_SECRET
  if (!s) throw new Error('CRON_SECRET not set — cannot sign rating tokens')
  return s
}

// Encodes userId + eventId into a URL-safe string and appends an HMAC signature.
// Deterministic: same inputs always produce the same token, so tokens survive
// email re-sends without invalidating older links.
export function signRatingToken(userId: string, eventId: string): string {
  const payload = Buffer.from(`${userId}|${eventId}`).toString('base64url')
  const sig = createHmac('sha256', getSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

// Returns { userId, eventId } or null if the token is malformed or the
// signature doesn't match (covers tampering and wrong-secret scenarios).
export function verifyRatingToken(token: string): { userId: string; eventId: string } | null {
  try {
    const secret = process.env.CRON_SECRET
    if (!secret) return null
    const dot = token.lastIndexOf('.')
    if (dot < 1) return null
    const payload = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    const expected = createHmac('sha256', secret).update(payload).digest('base64url')
    // Constant-time comparison to prevent timing attacks.
    if (sig.length !== expected.length) return null
    let diff = 0
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
    if (diff !== 0) return null
    const decoded = Buffer.from(payload, 'base64url').toString('utf8')
    const pipe = decoded.indexOf('|')
    if (pipe < 1) return null
    return { userId: decoded.slice(0, pipe), eventId: decoded.slice(pipe + 1) }
  } catch {
    return null
  }
}

// Full URL for a rating click in an email, e.g.
// https://whisperedevents.com/api/rate?token=...&rating=up
export function ratingUrl(
  userId: string,
  eventId: string,
  rating: 'up' | 'down',
  baseUrl: string,
): string {
  const token = signRatingToken(userId, eventId)
  return `${baseUrl}/api/rate?token=${encodeURIComponent(token)}&rating=${rating}`
}
