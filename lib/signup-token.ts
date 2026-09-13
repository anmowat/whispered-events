import { createHmac } from 'crypto'

// Short-lived proof that the bearer just completed signup as a specific user.
//
// Exists because a member holds NO session at the end of signup - they're
// status Pending, and the magic-link endpoint refuses inactive users - yet the
// finish screen needs to write contacts on their behalf. An endpoint taking a
// bare user id would let anyone write onto any account.
//
// Same construction as lib/email-rating.ts, with one deliberate difference:
// those tokens are permanent so email re-sends keep working, while this one
// carries an issued-at and expires. It authorises a write, not a page view.

const TTL_MS = 30 * 60 * 1000

function getSecret(): string {
  const s = process.env.CRON_SECRET
  if (!s) throw new Error('CRON_SECRET not set - cannot sign signup tokens')
  return s
}

export function signSignupToken(userId: string, issuedAt = Date.now()): string {
  const payload = Buffer.from(`${userId}|${issuedAt}`).toString('base64url')
  const sig = createHmac('sha256', getSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/** Returns the user id, or null if the token is malformed, tampered with, or
 *  older than the TTL. */
export function verifySignupToken(token: string): string | null {
  try {
    const secret = process.env.CRON_SECRET
    if (!secret) return null
    const dot = token.lastIndexOf('.')
    if (dot < 1) return null
    const payload = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    const expected = createHmac('sha256', secret).update(payload).digest('base64url')
    // Constant-time comparison, as in email-rating.
    if (sig.length !== expected.length) return null
    let diff = 0
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
    if (diff !== 0) return null

    const decoded = Buffer.from(payload, 'base64url').toString('utf8')
    const pipe = decoded.lastIndexOf('|')
    if (pipe < 1) return null
    const userId = decoded.slice(0, pipe)
    const issuedAt = Number(decoded.slice(pipe + 1))
    if (!userId || !Number.isFinite(issuedAt)) return null
    // Reject a future-dated token too - a clock skew that large means
    // something is wrong, and it would otherwise extend the window.
    const age = Date.now() - issuedAt
    if (age < -60_000 || age > TTL_MS) return null
    return userId
  } catch {
    return null
  }
}
