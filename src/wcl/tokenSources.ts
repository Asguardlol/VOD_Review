import type { WclTokenSource } from './client'

const STORAGE_KEY = 'wcl.bearerToken'

/**
 * Option 1: the user pastes their own bearer token.
 *
 * Works on GitHub Pages today with no backend. The trade-offs are real and the
 * UI should state them: tokens expire so it needs re-pasting, it only works for
 * someone who can generate one, and it is stored in `localStorage` — which is
 * readable by any script on this origin. That is acceptable for a personal or
 * guild tool and not acceptable if this is ever handed to strangers.
 */
export class PastedTokenSource implements WclTokenSource {
  readonly describe = 'Personal bearer token stored in this browser'

  async getToken(): Promise<string | undefined> {
    return localStorage.getItem(STORAGE_KEY) ?? undefined
  }

  static set(token: string): void {
    localStorage.setItem(STORAGE_KEY, token.trim())
  }

  static clear(): void {
    localStorage.removeItem(STORAGE_KEY)
  }

  static has(): boolean {
    return !!localStorage.getItem(STORAGE_KEY)
  }
}

/**
 * Option 2: a backend proxy holds the client secret.
 *
 * The browser sends no credential at all — that is the entire point, and why
 * `getToken` returning undefined has to be a supported answer rather than an
 * error. The proxy is responsible for whitelisting which queries it forwards.
 */
export class ProxyTokenSource implements WclTokenSource {
  readonly describe = 'Backend proxy holds the credential'

  async getToken(): Promise<string | undefined> {
    return undefined
  }
}
