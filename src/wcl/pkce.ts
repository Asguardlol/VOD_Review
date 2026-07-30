/**
 * Warcraft Logs OAuth, authorization code + PKCE.
 *
 * ## Why PKCE and not the other two
 *
 * WCL's client-credentials flow needs a client secret, which cannot live in a
 * static frontend — everything shipped to the browser is readable, and GitHub
 * Pages has no server to hide it behind. PKCE exists precisely for this case:
 * the client proves it started the exchange by holding a one-time random
 * verifier, so no long-lived secret is needed.
 *
 * It is also the only option that reaches **private and guild reports**, because
 * the resulting token authenticates the actual user rather than an anonymous
 * app. That is why it replaced the earlier paste-a-bearer-token approach
 * outright rather than sitting alongside it.
 */

import { base64UrlEncode, randomString } from '../core/random'

const AUTHORIZE_URL = 'https://www.warcraftlogs.com/oauth/authorize'
const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token'

const VERIFIER_KEY = 'wcl.pkceVerifier'
const STATE_KEY = 'wcl.pkceState'
const RETURN_ROUTE_KEY = 'wcl.returnRoute'
const TOKEN_KEY = 'wcl.token'

interface StoredToken {
  accessToken: string
  refreshToken?: string
  /** Unix ms. */
  expiresAt: number
}

export function getWclClientId(): string | undefined {
  return import.meta.env.VITE_WCL_CLIENT_ID || undefined
}

export function isWclConfigured(): boolean {
  return !!getWclClientId()
}

/**
 * Redirect target. Must match what is registered on the WCL client exactly.
 *
 * Excludes the fragment deliberately: this app uses hash routing, and a route
 * in the redirect URI would break the exact-match requirement.
 */
export function getRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

export function getStoredWclToken(): string | undefined {
  const raw = localStorage.getItem(TOKEN_KEY)
  if (!raw) return undefined
  try {
    const token = JSON.parse(raw) as StoredToken
    // A minute of slack: a token that expires mid-request is a confusing 401.
    if (token.expiresAt - 60_000 < Date.now()) return undefined
    return token.accessToken
  } catch {
    return undefined
  }
}

export function hasWclToken(): boolean {
  return !!getStoredWclToken()
}

export function clearWclToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** Starts the flow. Remembers the current route so the user comes back to it. */
export async function beginWclLogin(): Promise<void> {
  const clientId = getWclClientId()
  if (!clientId) return

  const verifier = randomString(32)
  const state = randomString(16)
  // sessionStorage, not local: this is one-shot and must not outlive the tab.
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)
  sessionStorage.setItem(RETURN_ROUTE_KEY, window.location.hash)

  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', getRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', await challengeFor(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  window.location.assign(url.toString())
}

/**
 * Completes the flow if this load is a redirect back from WCL.
 *
 * Returns true when it handled a callback, so the caller can hold off rendering
 * until the redirect settles. Unlike Twitch's implicit grant the code arrives as
 * a query parameter, so it does not collide with hash routing — but it still has
 * to be cleared out of the URL so a refresh cannot replay a spent code.
 */
export async function completeWclLogin(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const returnedState = params.get('state')
  if (!code) return false

  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  const expectedState = sessionStorage.getItem(STATE_KEY)
  const returnRoute = sessionStorage.getItem(RETURN_ROUTE_KEY) || '#/'
  sessionStorage.removeItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(RETURN_ROUTE_KEY)

  const clientId = getWclClientId()

  // State mismatch means this callback did not originate here. Drop it.
  if (!verifier || !clientId || returnedState !== expectedState) {
    window.location.replace(`${getRedirectUri()}${returnRoute}`)
    return true
  }

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: getRedirectUri(),
        // Proves this is the same client that started the flow. Replaces the
        // secret entirely — this is the whole point of PKCE.
        code_verifier: verifier,
      }),
    })
    if (response.ok) {
      const body = (await response.json()) as {
        access_token: string
        refresh_token?: string
        expires_in: number
      }
      const token: StoredToken = {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: Date.now() + body.expires_in * 1000,
      }
      localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
    }
  } catch {
    // Swallowed on purpose: the redirect below still has to happen, or the user
    // is stranded on a URL with a spent code in it.
  }

  window.location.replace(`${getRedirectUri()}${returnRoute}`)
  return true
}
