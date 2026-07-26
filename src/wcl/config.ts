import type { WclClient } from './client'
import { WclGraphQlClient } from './graphqlClient'
import { PastedTokenSource, ProxyTokenSource } from './tokenSources'

/**
 * Which Warcraft Logs integration is active.
 *
 * **Deliberately `disabled` unless configured.** Choosing between "users paste
 * their own token" and "run a proxy" is a real decision with different
 * security and distribution consequences, and it is the maintainer's to make —
 * so nothing here picks one by default. Everything except death lines and log
 * browsing works with WCL off.
 *
 * Set `VITE_WCL_MODE` at build time to turn it on:
 *   token  — users paste their own bearer token (no backend, works on Pages)
 *   proxy  — VITE_WCL_ENDPOINT points at a backend holding the client secret
 */
export type WclMode = 'disabled' | 'token' | 'proxy'

const WCL_API = 'https://www.warcraftlogs.com/api/v2/client'

export function getWclMode(): WclMode {
  const mode = import.meta.env.VITE_WCL_MODE
  return mode === 'token' || mode === 'proxy' ? mode : 'disabled'
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
