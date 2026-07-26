import type { ResolvedVod } from '../core/types'
import { clearTwitchToken, getStoredToken, getTwitchClientId } from './auth'

/**
 * The bits of Twitch Helix this app needs: turn a channel name into the VOD
 * that was live during a given time range.
 */

const HELIX = 'https://api.twitch.tv/helix'

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

interface HelixUser {
  id: string
  login: string
  display_name: string
  profile_image_url: string
}

interface HelixVideo {
  id: string
  title: string
  /** ISO 8601. When the broadcast started. */
  created_at: string
  /** Twitch's own format, e.g. "3h20m15s". */
  duration: string
  thumbnail_url: string
}

/**
 * Twitch reports duration as `3h20m15s`, omitting zero parts.
 * Returns ms, or 0 if it can't be read — a 0 makes the VOD fail the coverage
 * check rather than silently matching everything.
 */
export function parseTwitchDuration(duration: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(duration.trim())
  if (!match || (!match[1] && !match[2] && !match[3])) return 0
  const [, h, m, s] = match
  return (Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000
}

async function helixFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const clientId = getTwitchClientId()
  const token = getStoredToken()
  if (!clientId) {
    throw new TwitchAuthError('No Twitch Client ID is configured for this build.')
  }
  if (!token) {
    throw new TwitchAuthError('Connect Twitch to look up channels.')
  }

  const url = new URL(`${HELIX}${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new TwitchRequestError(
      'Could not reach Twitch. Check your connection, or whether an extension ' +
        'is blocking the request.',
    )
  }

  if (response.status === 401) {
    // Implicit-grant tokens expire. Drop the dead one so the UI offers a
    // reconnect instead of failing the same way on every retry.
    clearTwitchToken()
    throw new TwitchAuthError('The Twitch connection expired. Reconnect to continue.')
  }
  if (!response.ok) {
    throw new TwitchRequestError(`Twitch returned HTTP ${response.status}.`)
  }

  return (await response.json()) as T
}

/** Resolves a channel login to a user. Returns undefined when no such channel. */
export async function getUserByLogin(login: string): Promise<HelixUser | undefined> {
  const data = await helixFetch<{ data: HelixUser[] }>('/users', { login })
  return data.data[0]
}

/** Archived broadcasts for a channel, newest first (Twitch's own order). */
export async function getArchiveVideos(userId: string): Promise<HelixVideo[]> {
  const data = await helixFetch<{ data: HelixVideo[] }>('/videos', {
    user_id: userId,
    type: 'archive',
    first: '100',
  })
  return data.data
}

/**
 * Picks the VOD that was live across a report's time range.
 *
 * Overlap, not containment: a raider who started streaming mid-raid or stopped
 * before the last pull still has usable footage for the pulls they did catch.
 * Requiring full containment would grey them out for no good reason.
 *
 * When several overlap, the one covering the most of the range wins — that is
 * the one most pulls will be findable in.
 */
export function pickVodForRange(
  videos: HelixVideo[],
  rangeStart: number,
  rangeEnd: number,
): ResolvedVod | undefined {
  let best: ResolvedVod | undefined
  let bestOverlap = 0

  for (const video of videos) {
    const startedAt = Date.parse(video.created_at)
    const durationMs = parseTwitchDuration(video.duration)
    if (!Number.isFinite(startedAt) || durationMs <= 0) continue

    const endedAt = startedAt + durationMs
    const overlap = Math.min(endedAt, rangeEnd) - Math.max(startedAt, rangeStart)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = {
        platform: 'twitch',
        videoId: video.id,
        startedAt,
        durationMs,
        title: video.title,
      }
    }
  }

  return best
}

/**
 * Full lookup for one channel: name to a VOD covering the range.
 *
 * Throws only on auth/network problems. "No such channel" and "streamed nothing
 * then" are ordinary answers, not errors, and are reported as `undefined` with a
 * reason so the sidebar can grey the entry out and say which it was.
 */
export async function resolveChannelVod(
  login: string,
  rangeStart: number,
  rangeEnd: number,
): Promise<
  | { ok: true; vod: ResolvedVod; user: HelixUser }
  | { ok: false; reason: 'channel-not-found' | 'no-vod-in-range' }
> {
  const user = await getUserByLogin(login)
  if (!user) return { ok: false, reason: 'channel-not-found' }

  const videos = await getArchiveVideos(user.id)
  const vod = pickVodForRange(videos, rangeStart, rangeEnd)
  if (!vod) return { ok: false, reason: 'no-vod-in-range' }

  return { ok: true, vod, user }
}

/**
 * Reads a channel login out of whatever was pasted: a bare name, a channel URL,
 * or a URL with extra path segments.
 */
export function parseChannelLogin(input: string): string | undefined {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return undefined
  if (/^[a-z0-9_]{3,25}$/.test(trimmed)) return trimmed

  const match = /twitch\.tv\/([a-z0-9_]{3,25})/.exec(trimmed)
  return match ? match[1] : undefined
}
