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
 * A confident match, for deciding whether to fire a request without being asked.
 *
 * Stricter than `parseReportCode` on purpose. That one falls back to accepting
 * any alphanumeric string, which is right when the user has explicitly asked to
 * load something — but as an auto-trigger it would fire on the first letter of
 * anything typed. This only matches a real report URL or a full-length code.
 */
/**
 * The Warcraft Logs page for a report, optionally landing on one pull.
 *
 * `#fight=` is WCL's own anchor, so a link built with it opens on the pull you
 * are looking at rather than at the top of the night — which is the whole
 * reason to hand someone the log rather than the report code.
 */
export function reportUrl(code: string, fightId?: number): string {
  const base = `https://www.warcraftlogs.com/reports/${code}`
  return fightId === undefined ? base : `${base}#fight=${fightId}`
}

export function confidentReportCode(input: string): string | undefined {
  const trimmed = input.trim()
  const fromUrl = /warcraftlogs\.com\/reports\/([a-zA-Z0-9]+)/.exec(trimmed)
  if (fromUrl) return fromUrl[1]
  return /^[a-zA-Z0-9]{16}$/.test(trimmed) ? trimmed : undefined
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
