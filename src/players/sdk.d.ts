/**
 * Minimal typings for the two third-party player SDKs.
 *
 * Hand-written rather than pulled from DefinitelyTyped: this covers only the
 * calls the sync engine actually makes, so it stays readable and does not add
 * dependencies for a build that has to stay simple.
 */

interface YTPlayerEvent {
  target: YTPlayer
  data: number
}

interface YTPlayer {
  playVideo(): void
  pauseVideo(): void
  /**
   * `allowSeekAhead` tells YouTube it may request unbuffered data. False during
   * a scrub-drag, true on release — otherwise every intermediate position fires
   * a network request.
   */
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  mute(): void
  unMute(): void
  setVolume(volume0to100: number): void
  setPlaybackRate(rate: number): void
  destroy(): void
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId?: string
      host?: string
      playerVars?: Record<string, string | number>
      events?: {
        onReady?: (event: YTPlayerEvent) => void
        onStateChange?: (event: YTPlayerEvent) => void
        onError?: (event: YTPlayerEvent) => void
      }
    },
  ) => YTPlayer
  PlayerState: {
    UNSTARTED: number
    ENDED: number
    PLAYING: number
    PAUSED: number
    BUFFERING: number
    CUED: number
  }
}

interface TwitchPlayerInstance {
  play(): void
  pause(): void
  seek(seconds: number): void
  getCurrentTime(): number
  getDuration(): number
  getEnded(): boolean
  isPaused(): boolean
  setMuted(muted: boolean): void
  getMuted(): boolean
  setVolume(volume0to1: number): void
  addEventListener(event: string, callback: () => void): void
  removeEventListener(event: string, callback: () => void): void
}

interface TwitchNamespace {
  Player: {
    new (
      element: HTMLElement | string,
      options: {
        video?: string
        channel?: string
        width?: string | number
        height?: string | number
        autoplay?: boolean
        muted?: boolean
        time?: string
        /**
         * Required by Twitch: every hostname that will frame this player.
         * Derived from window.location.hostname at runtime, so localhost and
         * the deployed Pages domain both work without configuration.
         */
        parent?: string[]
      },
    ): TwitchPlayerInstance
    READY: string
    PLAY: string
    PAUSE: string
    ENDED: string
    PLAYING: string
    SEEK: string
    OFFLINE: string
    ONLINE: string
  }
}

interface Window {
  YT?: YTNamespace
  onYouTubeIframeAPIReady?: () => void
  Twitch?: TwitchNamespace
}
