// Generate a Supabase users.id in Airtable's record-id format ("recXXXXXXXXXXXXXX",
// 17 chars total). Existing downstream tables — matches, contributions,
// user_digest_state, events.host_ids — reference users by this format as
// opaque strings; keeping the same shape avoids a schema migration when we
// stop creating users in Airtable.
//
// Alphabet matches Airtable's: digits + upper + lower. Uses crypto.randomUUID
// where available for entropy; falls back to Math.random which is fine for an
// id space this large given we're not adversarial about collisions.

const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export function newUserId(): string {
  const bytes = new Uint8Array(14)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let out = 'rec'
  for (let i = 0; i < bytes.length; i++) {
    out += ALPHA[bytes[i] % ALPHA.length]
  }
  return out
}
