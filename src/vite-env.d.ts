/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which Warcraft Logs integration to build in. See src/wcl/config.ts. */
  readonly VITE_WCL_MODE?: 'disabled' | 'token' | 'proxy'
  /** Proxy endpoint, required when VITE_WCL_MODE=proxy. */
  readonly VITE_WCL_ENDPOINT?: string
  /**
   * Twitch application Client ID. Public by design — the implicit grant flow is
   * built for clients that cannot hold a secret, so this is safe to commit.
   */
  readonly VITE_TWITCH_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
