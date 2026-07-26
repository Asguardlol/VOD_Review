import type { VodReview } from './types'

/**
 * Everything the UI needs from persistence.
 *
 * Phase 0 is backed entirely by IndexedDB, which is all GitHub Pages can do on
 * its own — static hosting has no server to talk to. Phase 1 could add an
 * implementation backed by a small API (Cloudflare Workers + D1) for real share
 * links and cross-device history. Because the UI only ever sees this interface,
 * adding that backend is a new class, not a rewrite.
 *
 * `capabilities` lets the UI hide what the active backend cannot do, instead of
 * offering a button that fails.
 */
export interface ReviewStore {
  readonly capabilities: StoreCapabilities

  listReviews(): Promise<ReviewSummary[]>
  getReview(id: string): Promise<VodReview | undefined>
  createReview(title: string): Promise<VodReview>
  /**
   * Autosave. Overwrites in place.
   *
   * Dragging the sync handle fires this constantly, so it must stay cheap and
   * must not accumulate history entries.
   */
  saveReview(review: VodReview): Promise<void>
  deleteReview(id: string): Promise<void>

  /**
   * Publishes a review and returns a URL to hand out. Only meaningful when
   * `capabilities.remoteSharing` is true; the local store throws instead.
   *
   * Local-only sharing does not go through here — it encodes the whole review
   * into the URL fragment (see `share.ts`), which needs no backend.
   */
  share?(reviewId: string): Promise<string>
}

export interface StoreCapabilities {
  /** Server-side reviews reachable from any device via a short link. */
  remoteSharing: boolean
  /** Multiple people annotating the same review concurrently. */
  liveCollaboration: boolean
}

export interface ReviewSummary {
  id: string
  publicId?: string
  title: string
  povCount: number
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
