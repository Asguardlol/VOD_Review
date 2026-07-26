import type { WclClient } from './client'
import { WclGraphQlClient } from './graphqlClient'
import { PastedTokenSource, ProxyTokenSource } from './tokenSources'

/**
 * Which Warcraft Logs integration is active.
 *
 * Defaults to `token`: this is hosted on GitHub Pages, which is static-only, so
 * there is no server to hide a client secret behind and the proxy option would
 * mean standing up a separate deployment. Pasting a personal bearer token is the
 * only approach that works on Pages alone.
 *
 * What that means in practice: the token lives in this browser's
 * `localStorage`, it goes nowhere except warcraftlogs.com, and it expires — so
 * it needs re-pasting periodically. That is acceptable for a personal or guild
 * tool. If this is ever opened up to people who can't generate their own token,
 * switch to `proxy` and stand up the Worker; the client code does not change.
 *
 * Override with `VITE_WCL_MODE`:
 *   token    — user pastes their own bearer token (no backend; the default)
 *   proxy    — VITE_WCL_ENDPOINT points at a backend holding the client secret
 *   disabled — no Warcraft Logs features at all
 */
export type WclMode = 'disabled' | 'token' | 'proxy'

const WCL_API = 'https://www.warcraftlogs.com/api/v2/client'

export function getWclMode(): WclMode {
  const mode = import.meta.env.VITE_WCL_MODE
  if (mode === 'proxy' || mode === 'disabled') return mode
  return 'token'
}

/** Returns `undefined` when WCL is off, which every caller must handle. */
export function createWclClient(): WclClient | undefined {
  switch (getWclMode()) {
    case 'token':
      return new WclGraphQlClient(WCL_API, new PastedTokenSource())
    case 'proxy': {
      const endpoint = import.meta.env.VITE_WCL_ENDPOINT
      if (!endpoint) {
        // Misconfiguration, not a user error — failing loudly here beats
        // silently posting queries at warcraftlogs.com with no credential.
        console.error('VITE_WCL_MODE=proxy requires VITE_WCL_ENDPOINT to be set.')
        return undefined
      }
      return new WclGraphQlClient(endpoint, new ProxyTokenSource())
    }
    case 'disabled':
      return undefined
  }
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
