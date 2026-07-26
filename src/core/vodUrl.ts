import type { VodPlatform } from './types'

/**
 * Parsing pasted video links.
 *
 * Adding a POV means pasting whatever the raider sent in Discord, so this
 * accepts every URL shape both platforms hand out, plus a bare id.
 */

export interface ParsedVod {
  platform: VodPlatform
  videoId: string
  /**
   * Timestamp from the URL, if present (`?t=` / `&t=`).
   *
   * Worth capturing: a raider who links "here's where I died" has effectively
   * already done the sync work, so this prefills `offsetMs` instead of making
   * the reviewer scrub for the same frame again.
   */
  startMs?: number
}

export type ParseVodResult =
  | { ok: true; vod: ParsedVod }
  | { ok: false; error: string }

const YOUTUBE_ID = /^[\w-]{11}$/
const TWITCH_ID = /^\d+$/

/**
 * Twitch timestamps are `1h2m3s`; YouTube uses either that or plain seconds.
 */
function parseTimestamp(raw: string | null): number | undefined {
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) return Number(raw) * 1000
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw)
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined
  const [, h, min, s] = m
  return ((Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)) * 1000)
}

export function parseVodUrl(input: string): ParseVodResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Paste a YouTube or Twitch link.' }

  // Bare ids, so a raider who sends just the id still works. Twitch ids are all
  // digits and YouTube ids are 11 chars, so there is no ambiguity between them.
  if (YOUTUBE_ID.test(trimmed)) {
    return { ok: true, vod: { platform: 'youtube', videoId: trimmed } }
  }
  if (TWITCH_ID.test(trimmed)) {
    return { ok: true, vod: { platform: 'twitch', videoId: trimmed } }
  }

  let url: URL
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  } catch {
    return { ok: false, error: 'That does not look like a URL.' }
  }

  const host = url.hostname.replace(/^www\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  const startMs = parseTimestamp(url.searchParams.get('t'))

  if (host === 'youtu.be') {
    const id = parts[0]
    return YOUTUBE_ID.test(id ?? '')
      ? { ok: true, vod: { platform: 'youtube', videoId: id, startMs } }
      : { ok: false, error: 'Could not find a video id in that YouTube link.' }
  }

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    // /watch?v=ID, plus /live/ID, /embed/ID and /shorts/ID which all put the id
    // in the path instead.
    const id =
      url.searchParams.get('v') ??
      (['live', 'embed', 'shorts', 'v'].includes(parts[0] ?? '')
        ? parts[1]
        : undefined)
    return YOUTUBE_ID.test(id ?? '')
      ? { ok: true, vod: { platform: 'youtube', videoId: id!, startMs } }
      : { ok: false, error: 'Could not find a video id in that YouTube link.' }
  }

  if (host === 'twitch.tv') {
    // twitch.tv/<channel>/clip/<slug>
    if (parts[1] === 'clip') {
      return { ok: false, error: TWITCH_CLIP_ERROR }
    }
    // /videos/123456789, and the legacy /<channel>/v/123456789.
    const id = parts[0] === 'videos' ? parts[1] : parts[1] === 'v' ? parts[2] : undefined
    if (TWITCH_ID.test(id ?? '')) {
      return { ok: true, vod: { platform: 'twitch', videoId: id!, startMs } }
    }
    return {
      ok: false,
      error:
        'That looks like a Twitch channel, not a VOD. Use a link to a specific ' +
        'video (twitch.tv/videos/...).',
    }
  }

  if (host === 'clips.twitch.tv') {
    return { ok: false, error: TWITCH_CLIP_ERROR }
  }

  return { ok: false, error: 'Only YouTube and Twitch links are supported.' }
}

/**
 * Clips are a hard no, not an unimplemented feature. The clip embed has no
 * `seek()` or `getCurrentTime()`, so a clip cannot be driven from a shared
 * timeline at any point in the future either — say so plainly rather than
 * letting someone add one and wonder why it never syncs.
 */
export const TWITCH_CLIP_ERROR =
  'Twitch clips cannot be synced — the clip player has no seek control. ' +
  'Use the full VOD (twitch.tv/videos/...) and sync to the moment instead.'
