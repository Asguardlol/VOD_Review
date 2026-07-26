import type { PovPlayer } from '../players/types'

/**
 * The shared-timeline engine.
 *
 * One timeline position drives N players. Seeking the timeline to `t` means
 * seeking POV `p` to `t + p.offsetMs`.
 *
 * Deliberately framework-free: this is a state machine with timers, and it
 * needs to run on a fixed cadence regardless of React's render schedule. The
 * hook in `useTimeline.ts` is a thin subscription on top.
 *
 * ## Why continuous correction rather than one seek
 *
 * Neither platform seeks frame-accurately — landing within ~±0.3s of the
 * requested position is normal, and players drift further apart the longer they
 * run. A single seek at play time looks correct for about twenty seconds and
 * then quietly isn't, which is worse than being obviously wrong. So a tick
 * measures every player against the reference and pulls stragglers back.
 */

/** Beyond this, a hard seek. Visible jump, but being wrong is worse. */
const DRIFT_SEEK_THRESHOLD_S = 0.5
/**
 * Beyond this but under the seek threshold, correct by briefly changing
 * playback rate — invisible where it's supported. YouTube only; Twitch's embed
 * has no rate control, so Twitch POVs go straight to the seek threshold.
 */
const DRIFT_NUDGE_THRESHOLD_S = 0.12
const NUDGE_RATE_FAST = 1.25
const NUDGE_RATE_SLOW = 0.75

const TICK_MS = 400

/**
 * After any seek, players need time to actually get there. Correcting inside
 * this window would read the pre-seek position and fight itself.
 */
const SEEK_SETTLE_MS = 1200

interface Registered {
  player: PovPlayer
  offsetMs: number
  /** True while a rate nudge is active, so it can be released afterwards. */
  nudging: boolean
  supportsRate: boolean
}

export interface TimelineState {
  positionMs: number
  playing: boolean
  /** True while held because at least one POV is buffering. */
  stalled: boolean
  /** POV ids currently stalling playback, for the UI to point at. */
  stalledPovIds: string[]
}

export class TimelineEngine {
  #players = new Map<string, Registered>()
  #positionMs = 0
  #playing = false
  #stalled = false
  #stalledPovIds: string[] = []
  /** Set when a stall paused playback, so it can resume once everyone recovers. */
  #resumeAfterStall = false
  #suppressCorrectionUntil = 0
  #audioPovId: string | undefined
  #volume = 1
  #tick: number | undefined
  #onChange: () => void

  constructor(onChange: () => void) {
    this.#onChange = onChange
  }

  /**
   * Starts the correction tick. Idempotent.
   *
   * Deliberately not done in the constructor: the engine outlives individual
   * effect runs, and React StrictMode mounts, cleans up, and mounts again in
   * development. A ticker started in the constructor and cleared by that first
   * cleanup would never come back, leaving an engine that accepts commands but
   * never advances — which looks exactly like broken playback.
   */
  start(): void {
    this.#tick ??= window.setInterval(() => this.#onTick(), TICK_MS)
  }

  /** Stops the tick. The engine stays usable and `start` can resume it. */
  stop(): void {
    if (this.#tick !== undefined) window.clearInterval(this.#tick)
    this.#tick = undefined
  }

  get state(): TimelineState {
    return {
      positionMs: this.#positionMs,
      playing: this.#playing,
      stalled: this.#stalled,
      stalledPovIds: this.#stalledPovIds,
    }
  }

  registerPlayer(
    povId: string,
    player: PovPlayer,
    offsetMs: number,
    supportsRate: boolean,
  ): void {
    this.#players.set(povId, { player, offsetMs, nudging: false, supportsRate })
    player.setMuted(povId !== this.#audioPovId)
    if (povId === this.#audioPovId) player.setVolume(this.#volume)
    // Bring a late arrival to wherever everyone else already is.
    player.seek(this.#targetSecondsFor(offsetMs))
    if (this.#playing) player.play()
    this.#onChange()
  }

  unregisterPlayer(povId: string): void {
    this.#players.delete(povId)
    this.#onChange()
  }

  /** Called when the user re-pins a POV's sync point. Re-aligns immediately. */
  setOffset(povId: string, offsetMs: number): void {
    const entry = this.#players.get(povId)
    if (!entry) return
    entry.offsetMs = offsetMs
    entry.player.seek(this.#targetSecondsFor(offsetMs))
    this.#suppressCorrectionUntil = performance.now() + SEEK_SETTLE_MS
    this.#onChange()
  }

  /**
   * Reads a POV's current position back as a timeline offset.
   *
   * This is what "sync here" calls: the user has scrubbed one POV to a
   * recognizable moment, and that moment becomes timeline zero for that POV.
   */
  offsetForCurrentPosition(povId: string): number | undefined {
    const entry = this.#players.get(povId)
    if (!entry) return undefined
    return Math.round(entry.player.getCurrentTime() * 1000 - this.#positionMs)
  }

  setAudioPov(povId: string | undefined): void {
    this.#audioPovId = povId
    for (const [id, entry] of this.#players) {
      entry.player.setMuted(id !== povId)
      if (id === povId) entry.player.setVolume(this.#volume)
    }
    this.#onChange()
  }

  setVolume(volume01: number): void {
    this.#volume = Math.min(1, Math.max(0, volume01))
    if (!this.#audioPovId) return
    this.#players.get(this.#audioPovId)?.player.setVolume(this.#volume)
  }

  /**
   * Must be called synchronously from a real user gesture.
   *
   * Browsers block programmatic playback otherwise. Every player is started
   * inside this same call stack for that reason, and all but the audio POV are
   * muted — muted playback is exempt from the gesture requirement, which is what
   * makes starting fifteen POVs at once work at all.
   */
  play(): void {
    if (this.#playing) return
    this.#playing = true
    this.#resumeAfterStall = false
    for (const { player } of this.#players.values()) player.play()
    this.#onChange()
  }

  pause(): void {
    if (!this.#playing) return
    this.#playing = false
    this.#resumeAfterStall = false
    for (const { player } of this.#players.values()) player.pause()
    this.#onChange()
  }

  togglePlay(): void {
    if (this.#playing) this.pause()
    else this.play()
  }

  seekTo(positionMs: number): void {
    this.#positionMs = Math.max(0, positionMs)
    for (const entry of this.#players.values()) {
      this.#releaseNudge(entry)
      entry.player.seek(this.#targetSecondsFor(entry.offsetMs))
    }
    this.#suppressCorrectionUntil = performance.now() + SEEK_SETTLE_MS
    this.#onChange()
  }

  seekBy(deltaMs: number): void {
    this.seekTo(this.#positionMs + deltaMs)
  }

  /**
   * Longest playable span, in ms — the timeline can't outrun its longest POV.
   * Returns 0 while nothing has reported a duration yet.
   */
  durationMs(): number {
    let max = 0
    for (const entry of this.#players.values()) {
      const usable = entry.player.getDuration() * 1000 - entry.offsetMs
      if (usable > max) max = usable
    }
    return Math.max(0, max)
  }


  // -------------------------------------------------------------------------

  #targetSecondsFor(offsetMs: number): number {
    return Math.max(0, (this.#positionMs + offsetMs) / 1000)
  }

  /** The player whose clock defines "now". Prefers the audible one. */
  #reference(): Registered | undefined {
    if (this.#audioPovId) {
      const preferred = this.#players.get(this.#audioPovId)
      if (preferred) return preferred
    }
    return this.#players.values().next().value
  }

  #releaseNudge(entry: Registered): void {
    if (!entry.nudging) return
    entry.nudging = false
    entry.player.setPlaybackRate(1)
  }

  #onTick(): void {
    if (this.#players.size === 0) return

    const stalledIds: string[] = []
    for (const [id, entry] of this.#players) {
      if (entry.player.isBuffering()) stalledIds.push(id)
    }

    // One POV buffering means every other POV is running ahead of it. Holding
    // everyone is the only way the angles stay comparable.
    if (stalledIds.length > 0 && this.#playing) {
      this.#stalled = true
      this.#stalledPovIds = stalledIds
      this.#resumeAfterStall = true
      this.#playing = false
      for (const { player } of this.#players.values()) player.pause()
      this.#onChange()
      return
    }

    if (stalledIds.length === 0 && this.#stalled) {
      this.#stalled = false
      this.#stalledPovIds = []
      if (this.#resumeAfterStall) {
        this.#resumeAfterStall = false
        // Re-align before resuming: whoever stalled is now behind the rest.
        this.seekTo(this.#positionMs)
        this.#playing = true
        for (const { player } of this.#players.values()) player.play()
      }
      this.#onChange()
      return
    }

    const reference = this.#reference()
    if (!reference) return

    // Timeline position is read back from a real player rather than a wall
    // clock. The wall clock would keep counting through stalls and seeks and
    // slowly describe a state no player is actually in.
    const referencePosition =
      reference.player.getCurrentTime() * 1000 - reference.offsetMs
    if (Number.isFinite(referencePosition) && referencePosition >= 0) {
      this.#positionMs = referencePosition
    }

    if (performance.now() < this.#suppressCorrectionUntil) {
      this.#onChange()
      return
    }

    if (this.#playing) this.#correctDrift(reference)
    this.#onChange()
  }

  #correctDrift(reference: Registered): void {
    for (const entry of this.#players.values()) {
      if (entry === reference) continue

      const expected = this.#targetSecondsFor(entry.offsetMs)
      const actual = entry.player.getCurrentTime()
      if (!Number.isFinite(actual)) continue
      const drift = actual - expected

      if (Math.abs(drift) > DRIFT_SEEK_THRESHOLD_S) {
        this.#releaseNudge(entry)
        entry.player.seek(expected)
        continue
      }

      if (!entry.supportsRate) {
        // No rate control (Twitch): small drift is left alone rather than
        // seek-thrashing the player every tick over a tenth of a second.
        continue
      }

      if (Math.abs(drift) > DRIFT_NUDGE_THRESHOLD_S) {
        entry.nudging = true
        entry.player.setPlaybackRate(drift > 0 ? NUDGE_RATE_SLOW : NUDGE_RATE_FAST)
      } else {
        this.#releaseNudge(entry)
      }
    }
  }
}
