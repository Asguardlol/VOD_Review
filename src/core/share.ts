import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string'
import type { VodReview } from './types'
import { newId } from './ids'
import { normalizeReview } from './normalize'

/**
 * Sharing without a server.
 *
 * A review is mostly video ids plus integer offsets, so the whole thing
 * compresses small enough to live in a URL fragment. The fragment is never sent
 * to the server, which is exactly right here — GitHub Pages could not do
 * anything with it anyway.
 *
 * Practical ceiling: browsers and chat clients start truncating somewhere around
 * 8–32k characters. `encodeReview` reports the length so the UI can warn and
 * offer a JSON download instead of silently handing out a broken link.
 */

/** Past this, offer the JSON export instead — some clients will mangle the URL. */
export const URL_LENGTH_WARN_THRESHOLD = 8000

/**
 * Wire format. Deliberately versioned and separate from `VodReview`: a link
 * pasted into Discord today must still open after the app's model has moved on.
 */
interface SharePayloadV1 {
  v: 1
  review: VodReview
}

export function encodeReview(review: VodReview): {
  fragment: string
  length: number
} {
  const payload: SharePayloadV1 = { v: 1, review }
  const fragment = compressToEncodedURIComponent(JSON.stringify(payload))
  return { fragment, length: fragment.length }
}

/**
 * Builds the full shareable URL for a review.
 *
 * Hash-based routing means the payload rides after the route, so a deep link
 * works on Pages without a 404.html rewrite.
 */
export function buildShareUrl(review: VodReview, baseUrl?: string): string {
  const { fragment } = encodeReview(review)
  const origin = baseUrl ?? window.location.href.split('#')[0]
  return `${origin}#/shared/${fragment}`
}

/**
 * Decodes a shared review, returning `undefined` rather than throwing on
 * anything malformed — a truncated paste is the expected failure here, not an
 * exceptional one, and the caller shows a "link looks incomplete" message.
 */
export function decodeReview(fragment: string): VodReview | undefined {
  try {
    const json = decompressFromEncodedURIComponent(fragment)
    if (!json) return undefined
    const payload = JSON.parse(json) as SharePayloadV1
    if (payload?.v !== 1 || !payload.review) return undefined
    const review = payload.review
    if (!Array.isArray(review.povs) || typeof review.title !== 'string') {
      return undefined
    }
    return normalizeReview(review)
  } catch {
    return undefined
  }
}

/**
 * Prepares an opened share link for saving locally.
 *
 * Fresh ids on purpose: two people opening the same link and saving it should
 * end up with independent copies, not fight over one id.
 */
export function adoptSharedReview(review: VodReview): VodReview {
  const now = Date.now()
  return {
    ...review,
    id: newId(),
    publicId: undefined,
    createdAt: now,
    updatedAt: now,
  }
}

export function exportReviewJson(review: VodReview): string {
  return JSON.stringify({ v: 1, review } satisfies SharePayloadV1, null, 2)
}

export function importReviewJson(text: string): VodReview | undefined {
  try {
    const payload = JSON.parse(text) as SharePayloadV1
    if (payload?.v !== 1 || !payload.review) return undefined
    return adoptSharedReview(normalizeReview(payload.review))
  } catch {
    return undefined
  }
}
