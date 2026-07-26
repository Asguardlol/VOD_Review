import type { VodReview } from './types'

/**
 * Fills in fields added after a review was written.
 *
 * Reviews persist in IndexedDB and travel in share links, so data written by an
 * older build of the app will keep arriving indefinitely — a link pasted into
 * Discord months ago still has to open. Normalising on read is cheaper and
 * safer than a versioned migration for additive changes like these, and it
 * means every code path below this point can treat the arrays as present.
 */
export function normalizeReview(raw: VodReview): VodReview {
  return {
    ...raw,
    guilds: raw.guilds ?? [],
    povs: raw.povs ?? [],
    markers: raw.markers ?? [],
    deaths: raw.deaths ?? [],
  }
}
