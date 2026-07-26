import type { VodDeath, VodFight } from '../core/types'

/**
 * The Warcraft Logs seam.
 *
 * ## Why this is an interface
 *
 * WCL v2 uses OAuth2, and the client-credentials flow needs a client secret.
 * A secret cannot live in a static frontend — anything shipped to the browser is
 * public, and GitHub Pages has no server to hide it behind. That leaves exactly
 * two workable shapes:
 *
 *   1. the user supplies their own bearer token, or
 *   2. a small backend proxy holds the secret and forwards queries.
 *
 * Both are "make an authorized GraphQL request", differing only in where the
 * endpoint points and where the credential comes from. Injecting those two
 * things keeps them the same code path, so switching is configuration rather
 * than a rewrite.
 *
 * **Nothing in the app may hard-depend on this being available.** A review with
 * no log still works; it just has no death lines and an unbounded timeline.
 */
export interface WclClient {
  /** Fights in a report, so the user can pick the pull they want. */
  listFights(reportCode: string): Promise<WclReport>
  /** Deaths during one fight, already mapped onto pull-relative time. */
  listDeaths(fight: VodFight): Promise<VodDeath[]>
}

export interface WclReport {
  code: string
  title: string
  /** Unix ms. WCL event times are offsets from this. */
  startTime: number
  /** Unix ms the report ends. With `startTime`, the range to find VODs for. */
  endTime: number
  fights: VodFight[]
}

/**
 * Where the credential comes from.
 *
 * Returning `undefined` is legitimate and means "send no Authorization header" —
 * that is precisely the proxy case, where the backend attaches the credential
 * and the browser must not.
 */
export interface WclTokenSource {
  getToken(): Promise<string | undefined>
  /** Shown in settings so the user knows what is currently in effect. */
  readonly describe: string
}

export class WclAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WclAuthError'
  }
}

export class WclRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WclRequestError'
  }
}
