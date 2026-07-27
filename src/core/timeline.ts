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

/**
 * Beyond this, a hard seek.
 *
 * Deliberately large. A seek on Twitch is disruptive — it re-buffers and can
 * land hundreds of milliseconds off, so correcting a small drift often creates
 * a bigger one. Below this threshold, leaving the player alone genuinely beats
 * touching it, and the user has a per-stream delay control for anything that
 * stays consistently off.
 */
const DRIFT_SEEK_THRESHOLD_S = 2
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

/** Consecutive buffering ticks before the UI says so. ~1.2s at the tick rate. */
const STALL_TICKS_TO_REPORT = 3

/** Grace after an explicit play/pause, before believing what players report. */
const COMMAND_SETTLE_MS = 800

interface Registered {
  id: string
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
  /** Consecutive ticks seen buffering, for the reporting threshold. */
  #stallTicks = 0
  #suppressCorrectionUntil = 0
  #audioPovId: string | undefined
  /**
   * Starts below maximum. Selecting which stream to listen to should not also
   * be a decision to play it as loud as possible.
   */
  #volume = 0.6
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
    this.#players.set(povId, { id: povId, player, offsetMs, nudging: false, supportsRate })
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

  get volume(): number {
    return this.#volume
  }

  setVolume(volume01: number): void {
    this.#volume = Math.min(1, Math.max(0, volume01))
    if (!this.#audioPovId) return
    this.#players.get(this.#audioPovId)?.player.setVolume(this.#volume)
    this.#onChange()
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
    for (const { player } of this.#players.values()) player.play()
    // Players take a moment to report the new state. Without this grace period
    // the next tick reads the stale value and immediately undoes the command.
    this.#suppressCorrectionUntil = performance.now() + COMMAND_SETTLE_MS
    this.#onChange()
  }

  pause(): void {
    if (!this.#playing) return
    this.#playing = false
    for (const { player } of this.#players.values()) player.pause()
    this.#suppressCorrectionUntil = performance.now() + COMMAND_SETTLE_MS
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

    const settling = performance.now() < this.#suppressCorrectionUntil

    /*
     * Buffering is *reported*, never acted on.
     *
     * Pausing every player when one stalled was the original design, and it
     * had to go. Twitch exposes no buffering state, so it is inferred from
     * "the clock did not advance" — but Twitch's clock updates coarsely, so a
     * perfectly healthy stream reads as stalled a good fraction of the time.
     * Acting on that flag paused and resumed everything continuously, which is
     * far worse than the drift it was meant to prevent. Hysteresis cannot
     * rescue a signal that is wrong rather than noisy.
     *
     * Drift correction already handles a player that falls behind, which is
     * the actual consequence of a stall. So this now only drives the
     * "Buffering" badge.
     */
    const stalledIds: string[] = []
    if (!settling) {
      for (const [id, entry] of this.#players) {
        if (entry.player.isBuffering()) stalledIds.push(id)
      }
    }

    /*
     * Even as a display-only signal this needs holding down. Twitch's is
     * inferred and still flickers, and a badge that blinks on and off is worse
     * than no badge — it reads as the app malfunctioning rather than as the
     * stream being slow. Only sustained buffering is worth telling anyone about.
     */
    this.#stallTicks = stalledIds.length > 0 ? this.#stallTicks + 1 : 0
    const sustained = this.#stallTicks >= STALL_TICKS_TO_REPORT
    this.#stalled = sustained
    this.#stalledPovIds = sustained ? stalledIds : []

    const reference = this.#reference()
    if (!reference) return

    /*
     * Adopt the reference player's real state rather than trusting our own flag.
     *
     * Twitch renders its own controls inside the iframe, so playback can be
     * started or stopped without going through this engine at all. Left
     * one-directional, our transport would claim "paused" over a playing video.
     *
     * Bringing the others along is the point: hitting play on one embed should
     * mean the whole review plays, not one angle running away from the rest.
     */
    if (!settling) {
      const referencePlaying = reference.player.isPlaying()
      if (referencePlaying !== this.#playing) {
        this.#playing = referencePlaying
        for (const entry of this.#players.values()) {
          if (entry.id === reference.id) continue
          if (referencePlaying) entry.player.play()
          else entry.player.pause()
        }
      }
    }

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
