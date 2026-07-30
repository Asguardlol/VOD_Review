/**
 * Random values for the OAuth flows.
 *
 * Shared rather than copied per flow: both need the same thing — an unguessable
 * one-shot string — and two copies of a crypto helper is two things to get
 * subtly wrong.
 */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomString(byteLength: number): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)))
}
