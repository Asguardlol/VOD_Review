import type { ResolvedVod, VodStream } from '../core/types'
import { createTwitchPlayer } from './twitch'
import { createYouTubePlayer } from './youtube'
import type { PlayerCallbacks, PovPlayer } from './types'

export { PlayerError, UNAVAILABLE_MESSAGES } from './types'
export type { PovPlayer, PlayerCallbacks } from './types'

/**
 * Builds the right adapter for a resolved video. The only place the app
 * branches on platform — everything downstream talks to `PovPlayer`.
 */
export function createPlayer(
  streamId: string,
  vod: ResolvedVod,
  container: HTMLElement,
  startSeconds: number,
  callbacks?: PlayerCallbacks,
): Promise<PovPlayer> {
  switch (vod.platform) {
    case 'youtube':
      return createYouTubePlayer(streamId, container, vod.videoId, startSeconds, callbacks)
    case 'twitch':
      return createTwitchPlayer(streamId, container, vod.videoId, startSeconds, callbacks)
  }
}

/**
 * Twitch's embed has no rate control, so drift on a Twitch stream can only be
 * corrected by re-seeking. Reported per stream so the engine can pick the
 * gentler correction where it is available.
 */
export function supportsPlaybackRate(vod: ResolvedVod): boolean {
  return vod.platform === 'youtube'
}

/** True when every stream in a session is YouTube, so global rate is offerable. */
export function allSupportRate(streams: VodStream[]): boolean {
  return streams.every(
    (s) => s.source.kind === 'video' && s.source.platform === 'youtube',
  )
}
