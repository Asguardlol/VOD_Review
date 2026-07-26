import type { TwitchClient, TwitchTokenSource } from './client'
import { HelixTwitchClient } from './helix'
import { clearTwitchToken, getStoredToken, getTwitchClientId } from './auth'

const HELIX = 'https://api.twitch.tv/helix'

/**
 * The browser holds the token it obtained via implicit grant.
 *
 * This is the only source today. When a backend arrives it receives a token
 * acquired here rather than running its own OAuth, so the change is a second
 * implementation of this interface plus a different base URL — not a rewrite of
 * the calls.
 */
export class BrowserTwitchTokenSource implements TwitchTokenSource {
  readonly describe = 'Signed in with Twitch in this browser'

  async getToken(): Promise<string | undefined> {
    return getStoredToken()
  }

  invalidate(): void {
    clearTwitchToken()
  }
}

/** Returns `undefined` when Twitch is unconfigured; every caller must handle it. */
export function createTwitchClient(): TwitchClient | undefined {
  const clientId = getTwitchClientId()
  if (!clientId) return undefined
  return new HelixTwitchClient(HELIX, clientId, new BrowserTwitchTokenSource())
}
