import type { VodPov } from '../core/types'
import { createTwitchPlayer } from './twitch'
import { createYouTubePlayer } from './youtube'
import type { PlayerCallbacks, PovPlayer } from './types'

export { PlayerError, UNAVAILABLE_MESSAGES } from './types'
export type { PovPlayer, PlayerCallbacks } from './types'

/**
 * Builds the right adapter for a POV. The only place the app branches on
 * platform — everything downstream talks to `PovPlayer`.
 */
export function createPlayer(
  pov: VodPov,
  container: HTMLElement,
  startSeconds: number,
  callbacks?: PlayerCallbacks,
): Promise<PovPlayer> {
  switch (pov.platform) {
    case 'youtube':
      return createYouTubePlayer(pov.id, container, pov.videoId, startSeconds, callbacks)
    case 'twitch':
      return createTwitchPlayer(pov.id, container, pov.videoId, startSeconds, callbacks)
  }
}

/** Twitch's embed has no rate control, so mixed reviews cannot offer it. */
export function supportsPlaybackRate(povs: VodPov[]): boolean {
  return povs.every((p) => p.platform === 'youtube')
}
