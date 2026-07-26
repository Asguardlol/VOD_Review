/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Warcraft Logs application Client ID, registered as a *public* client so the
   * PKCE flow is available. Public by design — no secret is involved.
   */
  readonly VITE_WCL_CLIENT_ID?: string
  /**
   * Twitch application Client ID. Public by design — the implicit grant flow is
   * built for clients that cannot hold a secret, so this is safe to commit.
   */
  readonly VITE_TWITCH_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
