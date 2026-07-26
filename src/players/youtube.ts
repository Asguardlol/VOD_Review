import { loadYouTubeApi } from './scriptLoader'
import { PlayerError, type PlayerCallbacks, type PovPlayer } from './types'

/**
 * YouTube error codes, from the IFrame API reference.
 *
 * 101 and 150 are the same condition reported two ways ("embedding disabled by
 * request"). Age-restricted videos also surface here rather than as their own
 * code, which is why the message for embed-disabled has to stay general.
 */
const YT_ERROR_INVALID_PARAM = 2
const YT_ERROR_HTML5 = 5
const YT_ERROR_NOT_FOUND = 100
const YT_ERROR_NOT_EMBEDDABLE_A = 101
const YT_ERROR_NOT_EMBEDDABLE_B = 150

/** How long to wait for onReady before assuming the embed silently failed. */
const READY_TIMEOUT_MS = 15_000

export async function createYouTubePlayer(
  povId: string,
  container: HTMLElement,
  videoId: string,
  startSeconds: number,
  callbacks: PlayerCallbacks = {},
): Promise<PovPlayer> {
  await loadYouTubeApi()
  const YT = window.YT
  if (!YT?.Player) {
    throw new PlayerError('not-found', 'The YouTube player API failed to load.')
  }

  // YouTube replaces this element wholesale with its iframe, so give it a child
  // to consume rather than the container the app manages.
  const mount = document.createElement('div')
  container.appendChild(mount)

  let player: YTPlayer | undefined
  let buffering = false
  let playing = false
  let settled = false

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(
        new PlayerError(
          'not-found',
          'The YouTube player did not load. The video may be private or removed.',
        ),
      )
    }, READY_TIMEOUT_MS)

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      fn()
    }

    player = new YT.Player(mount, {
      videoId,
      playerVars: {
        // No related videos, no annotations, no branding — this is a review
        // tool, and the app owns the transport controls.
        rel: 0,
        modestbranding: 1,
        controls: 0,
        disablekb: 1,
        playsinline: 1,
        start: Math.max(0, Math.floor(startSeconds)),
        // Muted by default. The timeline unmutes exactly one POV; this is also
        // what lets many players start together without a gesture each.
        mute: 1,
      },
      events: {
        onReady: () => settle(resolve),
        onStateChange: () => {
          const state = player?.getPlayerState() ?? -1
          buffering = state === YT.PlayerState.BUFFERING
          playing = state === YT.PlayerState.PLAYING
          callbacks.onStateChange?.()
        },
        onError: (event) => {
          const code = event.data
          const error =
            code === YT_ERROR_NOT_EMBEDDABLE_A || code === YT_ERROR_NOT_EMBEDDABLE_B
              ? new PlayerError(
                  'embed-disabled',
                  'This video cannot be embedded (embedding disabled or age-restricted).',
                )
              : code === YT_ERROR_NOT_FOUND
                ? new PlayerError('not-found', 'This video does not exist or is private.')
                : code === YT_ERROR_INVALID_PARAM
                  ? new PlayerError('not-found', 'That YouTube video id is not valid.')
                  : code === YT_ERROR_HTML5
                    ? new PlayerError('not-found', 'The YouTube player could not play this video.')
                    : new PlayerError('not-found', `YouTube reported error ${code}.`)
          settle(() => reject(error))
          callbacks.onStateChange?.()
        },
      },
    })
  })

  return {
    povId,
    ready,
    play: () => player?.playVideo(),
    pause: () => player?.pauseVideo(),
    seek: (seconds) => player?.seekTo(Math.max(0, seconds), true),
    getCurrentTime: () => player?.getCurrentTime() ?? 0,
    getDuration: () => player?.getDuration() ?? 0,
    isBuffering: () => buffering,
    isPlaying: () => playing,
    setMuted: (muted) => (muted ? player?.mute() : player?.unMute()),
    setVolume: (v) => player?.setVolume(Math.round(v * 100)),
    setPlaybackRate: (rate) => player?.setPlaybackRate(rate),
    destroy: () => {
      player?.destroy()
      mount.remove()
    },
  }
}
