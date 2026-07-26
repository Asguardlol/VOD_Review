import type { ResolvedVod } from '../core/types'
import {
  TwitchAuthError,
  TwitchRequestError,
  type ResolveResult,
  type TwitchClient,
  type TwitchTokenSource,
} from './client'

/**
 * Twitch Helix: turn a channel name into the VOD that was live during a given
 * time range.
 *
 * Everything provider-specific stops here. Callers see `TwitchClient`.
 */

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
}

/**
 * Twitch reports duration as `3h20m15s`, omitting zero parts.
 *
 * Returns ms, or 0 if unreadable — a 0 makes the VOD fail the coverage check
 * rather than silently matching everything.
 */
export function parseTwitchDuration(duration: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(duration.trim())
  if (!match || (!match[1] && !match[2] && !match[3])) return 0
  const [, h, m, s] = match
  return (Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)) * 1000
}

/**
 * Picks the VOD that was live across a time range.
 *
 * Overlap, not containment: a raider who started streaming mid-raid or stopped
 * before the last pull still has usable footage for the pulls they did catch.
 * Requiring full containment would grey them out for no good reason.
 *
 * When several overlap, the one covering the most of the range wins — that is
 * the one the most pulls will be findable in.
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

    const overlap =
      Math.min(startedAt + durationMs, rangeEnd) - Math.max(startedAt, rangeStart)
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

export class HelixTwitchClient implements TwitchClient {
  #baseUrl: string
  #clientId: string
  #tokens: TwitchTokenSource

  constructor(baseUrl: string, clientId: string, tokens: TwitchTokenSource) {
    this.#baseUrl = baseUrl
    this.#clientId = clientId
    this.#tokens = tokens
  }

  async #get<T>(path: string, params: Record<string, string>): Promise<T> {
    const token = await this.#tokens.getToken()

    const url = new URL(`${this.#baseUrl}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

    const headers: Record<string, string> = { 'Client-Id': this.#clientId }
    if (token) headers.Authorization = `Bearer ${token}`

    let response: Response
    try {
      response = await fetch(url, { headers })
    } catch {
      throw new TwitchRequestError(
        'Could not reach Twitch. Check your connection, or whether an ' +
          'extension is blocking the request.',
      )
    }

    if (response.status === 401) {
      // Tokens expire. Drop the dead one so the UI offers a reconnect rather
      // than failing identically on every retry.
      this.#tokens.invalidate?.()
      throw new TwitchAuthError('The Twitch connection expired. Reconnect to continue.')
    }
    if (!response.ok) {
      throw new TwitchRequestError(`Twitch returned HTTP ${response.status}.`)
    }

    return (await response.json()) as T
  }

  async resolveChannelVod(
    login: string,
    rangeStart: number,
    rangeEnd: number,
  ): Promise<ResolveResult> {
    const users = await this.#get<{ data: HelixUser[] }>('/users', { login })
    const user = users.data[0]
    if (!user) return { ok: false, reason: 'channel-not-found' }

    const videos = await this.#get<{ data: HelixVideo[] }>('/videos', {
      user_id: user.id,
      type: 'archive',
      first: '100',
    })

    const vod = pickVodForRange(videos.data, rangeStart, rangeEnd)
    if (!vod) return { ok: false, reason: 'no-vod-in-range' }

    return { ok: true, vod, displayName: user.display_name }
  }
}
