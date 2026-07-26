/** Short, collision-resistant ids. No dependency needed — `crypto` is built in. */
export function newId(): string {
  return crypto.randomUUID()
}

/**
 * A shorter id for share URLs, where every character costs.
 *
 * 12 base32-ish chars ≈ 60 bits. These only need to be unique among one user's
 * reviews, not globally, so this is ample.
 */
export function newPublicId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz'
  let out = ''
  for (const b of bytes) out += alphabet[b % 32] + alphabet[(b >> 3) % 32]
  return out.slice(0, 12)
}
