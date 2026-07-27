import { loadTwitchApi } from './scriptLoader'
import { PlayerError, type PlayerCallbacks, type PovPlayer } from './types'

const READY_TIMEOUT_MS = 15_000

/**
 * After READY, how long to allow for a duration to appear.
 *
 * Twitch has no error event for a missing VOD — the iframe just renders its own
 * "content is unavailable" panel and the embed otherwise looks healthy. The one
 * reliable signal from outside the iframe is that duration never becomes
 * non-zero, so that is what gets polled.
 */
const DURATION_PROBE_MS = 4000
const DURATION_PROBE_INTERVAL_MS = 250

export async function createTwitchPlayer(
  povId: string,
  container: HTMLElement,
  videoId: string,
  startSeconds: number,
  callbacks: PlayerCallbacks = {},
): Promise<PovPlayer> {
  await loadTwitchApi()
  const Twitch = window.Twitch
  if (!Twitch?.Player) {
    throw new PlayerError('not-found', 'The Twitch player API failed to load.')
  }

  const mount = document.createElement('div')
  mount.style.width = '100%'
  mount.style.height = '100%'
  container.appendChild(mount)

  const player = new Twitch.Player(mount, {
    video: videoId,
    width: '100%',
    height: '100%',
    autoplay: false,
    // Muted for the same reason as YouTube: the timeline unmutes exactly one
    // POV, and muted players can be started together without a gesture each.
    muted: true,
    time: `${Math.max(0, Math.floor(startSeconds))}s`,
    // Twitch rejects the embed unless the framing hostname is declared. Taking
    // it from the live location means localhost and the deployed Pages domain
    // both work with no configuration.
    parent: [window.location.hostname],
  })

  let playing = false
  /**
   * Twitch exposes no buffering state at all, unlike YouTube's BUFFERING.
   * Inferred instead: playing, but the clock has not advanced between ticks.
   * The timeline reads this to hold every other POV when one stalls.
   */
  let buffering = false
  let lastTime = -1
  let lastTimeAt = 0

  const onPlay = () => {
    playing = true
    callbacks.onStateChange?.()
  }
  const onPause = () => {
    playing = false
    buffering = false
    callbacks.onStateChange?.()
  }
  player.addEventListener(Twitch.Player.PLAY, onPlay)
  player.addEventListener(Twitch.Player.PAUSE, onPause)
  player.addEventListener(Twitch.Player.ENDED, onPause)

  const stallWatcher = window.setInterval(() => {
    if (!playing) {
      buffering = false
      return
    }
    const now = player.getCurrentTime()
    if (now !== lastTime) {
      lastTime = now
      lastTimeAt = performance.now()
      if (buffering) {
        buffering = false
        callbacks.onStateChange?.()
      }
      return
    }
    /*
     * Twitch's clock updates coarsely — often only once a second or so — which
     * means a healthy stream regularly looks frozen for several hundred
     * milliseconds. A short threshold here reported near-constant buffering.
     * Two seconds is long enough to clear that granularity and still catch a
     * real stall.
     */
    if (!buffering && performance.now() - lastTimeAt > 2000) {
      buffering = true
      callbacks.onStateChange?.()
    }
  }, DURATION_PROBE_INTERVAL_MS)

  const ready = new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      fn()
    }

    const timeout = window.setTimeout(() => {
      settle(() =>
        reject(
          new PlayerError('not-found', 'The Twitch player did not load in time.'),
        ),
      )
    }, READY_TIMEOUT_MS)

    const onReady = () => {
      // READY only means the player mounted, not that a video exists behind it.
      const deadline = performance.now() + DURATION_PROBE_MS
      const probe = window.setInterval(() => {
        const duration = player.getDuration()
        if (duration > 0) {
          window.clearInterval(probe)
          settle(resolve)
          return
        }
        if (performance.now() > deadline) {
          window.clearInterval(probe)
          settle(() =>
            reject(
              new PlayerError(
                'vod-expired',
                'This Twitch VOD is unavailable — most likely expired or deleted. ' +
                  'Plain VODs are removed after about 14 days (60 for Partners/Turbo); ' +
                  'only highlights are permanent.',
              ),
            ),
          )
        }
      }, DURATION_PROBE_INTERVAL_MS)
    }

    player.addEventListener(Twitch.Player.READY, onReady)
  })

  return {
    povId,
    ready,
    play: () => player.play(),
    pause: () => player.pause(),
    seek: (seconds) => {
      // Clear the stall inference across a seek. Position necessarily jumps and
      // then sits still for a moment, which is indistinguishable from buffering
      // to a watcher that only looks at whether the clock advanced.
      buffering = false
      lastTime = -1
      lastTimeAt = performance.now()
      player.seek(Math.max(0, seconds))
    },
    getCurrentTime: () => player.getCurrentTime() ?? 0,
    getDuration: () => player.getDuration() ?? 0,
    isBuffering: () => buffering,
    isPlaying: () => playing,
    setMuted: (muted) => player.setMuted(muted),
    setVolume: (v) => player.setVolume(v),
    // Twitch's embed exposes no playback-rate control. Kept as a no-op so the
    // timeline can stay platform-agnostic; the UI disables rate when any Twitch
    // POV is present rather than pretending it worked.
    setPlaybackRate: () => {},
    destroy: () => {
      window.clearInterval(stallWatcher)
      player.removeEventListener(Twitch.Player.PLAY, onPlay)
      player.removeEventListener(Twitch.Player.PAUSE, onPause)
      player.removeEventListener(Twitch.Player.ENDED, onPause)
      mount.remove()
    },
  }
}
