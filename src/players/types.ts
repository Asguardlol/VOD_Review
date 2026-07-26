import type { StreamUnavailableReason } from '../core/types'

/**
 * The single surface the timeline drives.
 *
 * YouTube and Twitch expose similar-but-not-identical APIs, and the sync engine
 * should not care which is which. Everything platform-specific stops here.
 *
 * All times are **seconds**, matching both underlying APIs. Only the stored
 * model uses milliseconds; conversion happens at this boundary so the rest of
 * the app is not doing `/1000` in twenty places.
 */
export interface PovPlayer {
  readonly povId: string

  /** Resolves once the video is genuinely playable, rejects with a PlayerError. */
  readonly ready: Promise<void>

  play(): void
  pause(): void
  /** Seek to an absolute position within *this* video. */
  seek(seconds: number): void
  getCurrentTime(): number
  /** Video length in seconds, or 0 while unknown. */
  getDuration(): number

  /**
   * True while the player is stalled fetching data.
   *
   * The timeline watches this: when one POV buffers, the others must be held or
   * they run ahead and every angle drifts out of alignment.
   */
  isBuffering(): boolean
  isPlaying(): boolean

  setMuted(muted: boolean): void
  setVolume(volume01: number): void
  setPlaybackRate(rate: number): void

  destroy(): void
}

/** Why a video will not play. A subset of `StreamUnavailableReason`. */
export type PlayerFailure = Exclude<
  StreamUnavailableReason,
  'no-vod-in-range' | 'channel-not-found'
>

export class PlayerError extends Error {
  readonly reason: PlayerFailure

  constructor(reason: PlayerFailure, message: string) {
    super(message)
    this.name = 'PlayerError'
    this.reason = reason
  }
}

export const UNAVAILABLE_MESSAGES: Record<PlayerFailure, string> = {
  'embed-disabled':
    'The uploader disabled embedding for this video, so it cannot play here. ' +
    'It has to be re-uploaded with embedding allowed, or watched on the site directly.',
  'age-restricted':
    'This video is age-restricted and cannot play in an embed. ' +
    'Age-restricted videos have to be watched signed in on the platform itself.',
  'not-found':
    'This video no longer exists, or it is private. Check the link.',
  'vod-expired':
    'This Twitch VOD has expired. Plain VODs are deleted after about 14 days ' +
    '(60 for Partners/Turbo) — only highlights are kept permanently.',
}

export interface PlayerCallbacks {
  /** Fired on any state change worth re-rendering for (play/pause/buffer). */
  onStateChange?: () => void
}
