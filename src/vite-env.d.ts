/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Which Warcraft Logs integration to build in. See src/wcl/config.ts. */
  readonly VITE_WCL_MODE?: 'disabled' | 'token' | 'proxy'
  /** Proxy endpoint, required when VITE_WCL_MODE=proxy. */
  readonly VITE_WCL_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
