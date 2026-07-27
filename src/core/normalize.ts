import type { VodSession } from './types'

/**
 * Fills in fields added after a session was written.
 *
 * Sessions persist in IndexedDB and travel in share links, so data written by an
 * older build will keep arriving indefinitely — a link pasted into Discord
 * months ago still has to open. Normalising on read is cheaper and safer than a
 * versioned migration for additive changes, and it lets every code path below
 * this point treat the arrays as present.
 */
export function normalizeSession(raw: VodSession): VodSession {
  return {
    ...raw,
    title: raw.title ?? 'Untitled night',
    streams: raw.streams ?? [],
    guilds: raw.guilds ?? [],
    deaths: raw.deaths ?? [],
    events: raw.events ?? [],
    markers: raw.markers ?? [],
  }
}
