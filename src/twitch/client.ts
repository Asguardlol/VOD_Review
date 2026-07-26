import type { ResolvedVod } from '../core/types'

/**
 * The Twitch seam.
 *
 * Mirrors `WclClient`: the credential and the endpoint are injected rather than
 * reached for, so where the token comes from is a constructor argument instead
 * of a rewrite.
 *
 * That matters for the planned shape of this app. The browser will keep owning
 * OAuth — it obtains the token and passes it on — so a future server does not
 * run its own flow, it receives a token that was acquired here. Both the
 * direct-from-browser and relayed-through-a-server paths are then the same code
 * with a different `TwitchTokenSource` and endpoint.
 */
export interface TwitchClient {
  /** Resolves a channel login to the VOD covering a time range. */
  resolveChannelVod(
    login: string,
    rangeStart: number,
    rangeEnd: number,
  ): Promise<ResolveResult>
}

export type ResolveResult =
  | { ok: true; vod: ResolvedVod; displayName: string }
  | { ok: false; reason: 'channel-not-found' | 'no-vod-in-range' }

/**
 * Where the credential comes from.
 *
 * Returning `undefined` means "send no Authorization header". That is a real
 * case, not an error: a server-backed implementation attaches the credential
 * itself and the browser must not.
 */
export interface TwitchTokenSource {
  getToken(): Promise<string | undefined>
  /** Called when the provider rejects the credential, so it can be discarded. */
  invalidate?(): void
  /** Shown in settings so the user knows what is currently in effect. */
  readonly describe: string
}

export class TwitchAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TwitchAuthError'
  }
}

export class TwitchRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TwitchRequestError'
  }
}
