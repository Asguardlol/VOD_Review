/**
 * Twitch OAuth, implicit grant.
 *
 * ## Why this works on static hosting when Warcraft Logs doesn't
 *
 * Twitch's *client-credentials* flow needs a client secret, which cannot live in
 * a frontend — anything shipped to the browser is public. But the **implicit
 * grant** flow is designed for public clients: the Client ID is meant to be
 * visible, no secret is involved, and the token comes back in the URL fragment.
 * Helix then answers directly from the browser, with CORS.
 *
 * So channel lookup needs no backend. Warcraft Logs has no equivalent flow,
 * which is why that one is still paste-a-token or run a proxy.
 */

const TOKEN_KEY = 'twitch.accessToken'
const RETURN_ROUTE_KEY = 'twitch.returnRoute'

export function getTwitchClientId(): string | undefined {
  return import.meta.env.VITE_TWITCH_CLIENT_ID || undefined
}

export function isTwitchConfigured(): boolean {
  return !!getTwitchClientId()
}

export function getStoredToken(): string | undefined {
  return localStorage.getItem(TOKEN_KEY) ?? undefined
}

export function clearTwitchToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/**
 * The redirect target must match what is registered on the Twitch app exactly.
 *
 * Deliberately excludes the fragment: this app uses hash routing, and the hash
 * is also where Twitch puts the token. Sending a route in the redirect URI would
 * both break the exact-match requirement and get overwritten on the way back.
 */
export function getRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`
}

/** Sends the user to Twitch. Remembers where they were so they come back to it. */
export function beginTwitchLogin(): void {
  const clientId = getTwitchClientId()
  if (!clientId) return
  sessionStorage.setItem(RETURN_ROUTE_KEY, window.location.hash)

  const url = new URL('https://id.twitch.tv/oauth2/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', getRedirectUri())
  url.searchParams.set('response_type', 'token')
  // Public VOD listings need no scopes — only an app or user token. Asking for
  // nothing keeps the consent screen honest about what this actually reads.
  url.searchParams.set('scope', '')
  window.location.assign(url.toString())
}

/**
 * Picks the token out of the URL on the way back, then restores the route.
 *
 * Must run before the router reads the hash. Twitch returns
 * `#access_token=…&token_type=bearer`, which would otherwise look like a
 * garbage route and leave the token sitting in the address bar.
 */
export function captureTwitchToken(): boolean {
  const hash = window.location.hash
  if (!hash.includes('access_token=')) return false

  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const token = params.get('access_token')
  if (token) localStorage.setItem(TOKEN_KEY, token)

  const returnRoute = sessionStorage.getItem(RETURN_ROUTE_KEY) ?? '#/'
  sessionStorage.removeItem(RETURN_ROUTE_KEY)
  // replace, not assign: the token must not survive in history.
  window.location.replace(returnRoute || '#/')
  return true
}

/**
 * Confirms a stored token is still good.
 *
 * Implicit-grant tokens expire, and an expired one fails every Helix call with
 * a 401 that looks like a bug. Checking up front turns that into "reconnect".
 */
export async function validateToken(token: string): Promise<boolean> {
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${token}` },
    })
    return response.ok
  } catch {
    return false
  }
}
