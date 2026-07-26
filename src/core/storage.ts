import type { VodSession } from './types'

/**
 * Everything the UI needs from persistence.
 *
 * Phase 0 is backed entirely by IndexedDB, which is all GitHub Pages can do on
 * its own — static hosting has no server to talk to. Because the UI only ever
 * sees this interface, adding a backend later is a new class, not a rewrite.
 *
 * `capabilities` lets the UI hide what the active backend cannot do, instead of
 * offering a button that fails.
 */
export interface SessionStore {
  readonly capabilities: StoreCapabilities

  listSessions(): Promise<SessionSummary[]>
  getSession(id: string): Promise<VodSession | undefined>
  /** There is no "name it first" step — a session starts empty and fills in. */
  createSession(): Promise<VodSession>
  /**
   * Autosave. Overwrites in place.
   *
   * Nudging a broadcast delay fires this repeatedly, so it must stay cheap and
   * must not accumulate history entries.
   */
  saveSession(session: VodSession): Promise<void>
  deleteSession(id: string): Promise<void>

  /**
   * Publishes a session and returns a URL. Only meaningful when
   * `capabilities.remoteSharing` is true; the local store throws instead.
   *
   * Local-only sharing does not go through here — it encodes the session into
   * the URL fragment (see `share.ts`), which needs no backend.
   */
  share?(sessionId: string): Promise<string>
}

export interface StoreCapabilities {
  /** Server-side sessions reachable from any device via a short link. */
  remoteSharing: boolean
  /** Multiple people annotating the same session concurrently. */
  liveCollaboration: boolean
}

export interface SessionSummary {
  id: string
  publicId?: string
  title: string
  streamCount: number
  reportCode?: string
  updatedAt: number
}

/** Thrown when the UI reaches for something the active store can't do. */
export class UnsupportedCapabilityError extends Error {
  constructor(capability: keyof StoreCapabilities) {
    super(
      `This storage backend does not support "${capability}". ` +
        `Configure VITE_API_BASE_URL to enable it.`,
    )
    this.name = 'UnsupportedCapabilityError'
  }
}
