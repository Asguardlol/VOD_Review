import type { WclClient } from './client'
import { WclGraphQlClient } from './graphqlClient'
import { getStoredWclToken, isWclConfigured } from './pkce'

/**
 * Warcraft Logs API endpoint.
 *
 * `/user`, not `/client`: PKCE produces a *user* access token, and WCL routes
 * those through the user endpoint. Pointing a user token at `/client` fails in
 * ways that look like a bad query rather than a bad endpoint.
 */
const WCL_USER_API = 'https://www.warcraftlogs.com/api/v2/user'

/**
 * Returns `undefined` when Warcraft Logs is unconfigured or not connected,
 * which every caller must handle — the app still works without it, just with
 * no pull browser and no death markers.
 */
export function createWclClient(): WclClient | undefined {
  if (!isWclConfigured()) return undefined
  return new WclGraphQlClient(WCL_USER_API, {
    describe: 'Signed in with Warcraft Logs',
    async getToken() {
      return getStoredWclToken()
    },
  })
}

/**
 * Pulls a report code out of whatever the user pasted.
 *
 * Accepts a full report URL (with or without a `#fight=` fragment) or a bare
 * code, because both are things people paste.
 */
export function parseReportCode(input: string): string | undefined {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  if (/^[a-zA-Z0-9]{16}$/.test(trimmed)) return trimmed

  const match = /warcraftlogs\.com\/reports\/([a-zA-Z0-9]+)/.exec(trimmed)
  if (match) return match[1]

  // Fall back to a bare alphanumeric string — report codes vary in length
  // across WCL's history and rejecting a valid one is worse than trying it.
  return /^[a-zA-Z0-9]+$/.test(trimmed) ? trimmed : undefined
}
