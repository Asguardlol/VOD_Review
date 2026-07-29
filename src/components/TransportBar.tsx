import { useState, type CSSProperties } from 'react'
import type { TimelineEngine, TimelineState } from '../core/timeline'
import type { VodDeath, VodMarker } from '../core/types'
import { formatTime } from '../core/format'

interface Props {
  engine: TimelineEngine
  state: TimelineState
  markers: VodMarker[]
  deaths: VodDeath[]
  durationMs: number
  /** True when duration came from a log rather than from the longest VOD. */
  boundedByFight: boolean
  onAddMarker(): void
  onSeekMarker(marker: VodMarker): void
}

/**
 * Step sizes for nudging. Both platforms seek far too coarsely for real frame
 * stepping, so these are the smallest steps that reliably land somewhere useful.
 */
const NUDGE_MS = 1000
const JUMP_MS = 10_000

/**
 * Clicking a death lands slightly before it, not on it.
 *
 * The question a reviewer is asking is never "did they die" — it's "what killed
 * them", and that happened a few seconds earlier.
 */
const DEATH_LEAD_MS = 5000

export function TransportBar({
  engine,
  state,
  markers,
  deaths,
  durationMs,
  boundedByFight,
  onAddMarker,
  onSeekMarker,
}: Props) {
  // While dragging, the scrubber shows the dragged value rather than the
  // engine's — otherwise the tick fights the user's thumb every 400ms.
  const [scrubMs, setScrubMs] = useState<number | undefined>()
  // Time under the cursor, so you can read off a moment before committing to
  // a seek — the same thing the death tooltips answer, for the gaps between.
  const [hoverMs, setHoverMs] = useState<number | undefined>()
  const shown = scrubMs ?? state.positionMs
  const max = Math.max(durationMs, state.positionMs, 1)
  const ratio = (ms: number) => Math.min(100, Math.max(0, (ms / max) * 100))
  const percent = (ms: number) => `${ratio(ms)}%`

  /**
   * Maps cursor x to a time the same way `percent` maps a time to x, so the
   * readout agrees with where the death lines are actually drawn rather than
   * with the range thumb, which is inset by half its own width at each end.
   */
  function trackHover(e: React.PointerEvent<HTMLDivElement>) {
    // Touch has no hover: a tap would leave the label stuck until the next one.
    if (e.pointerType === 'touch') return
    const { left, width } = e.currentTarget.getBoundingClientRect()
    if (width === 0) return
    setHoverMs(Math.min(max, Math.max(0, ((e.clientX - left) / width) * max)))
  }

  return (
    <div className="transport">
      <div className="transport-row">
        <button
          className="play-button"
          onClick={() => engine.togglePlay()}
          title={state.playing ? 'Pause all' : 'Play all'}
        >
          {state.playing ? '❚❚' : '▶'}
        </button>

        <button onClick={() => engine.seekBy(-JUMP_MS)} title="Back 10s">
          ⏪
        </button>
        <button onClick={() => engine.seekBy(-NUDGE_MS)} title="Back 1s">
          ◀
        </button>
        <button onClick={() => engine.seekBy(NUDGE_MS)} title="Forward 1s">
          ▶
        </button>
        <button onClick={() => engine.seekBy(JUMP_MS)} title="Forward 10s">
          ⏩
        </button>

        <span className="transport-time">
          {formatTime(shown)}{' '}
          <span
            className="dim"
            title={
              boundedByFight
                ? 'Fight duration, from the log'
                : 'Longest VOD — attach a log to bound this by the pull instead'
            }
          >
            / {formatTime(durationMs)}
            {boundedByFight ? '' : ' (VOD)'}
          </span>
        </span>

        {/*
          Volume for whichever stream is currently the audible one. Previously
          the only way to affect volume was picking the audio stream, which
          jumped straight to full — loud and with no way back.
        */}
        <label className="volume" title="Volume of the audible stream">
          <span aria-hidden="true">🔊</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(engine.volume * 100)}
            aria-label="Volume"
            onChange={(e) => engine.setVolume(Number(e.target.value) / 100)}
          />
        </label>

        <button onClick={onAddMarker} title="Bookmark this moment">
          + Marker
        </button>

        {state.stalled && (
          <span
            className="stall-notice"
            title="Everything is held so the angles stay aligned"
          >
            Waiting for {state.stalledPovIds.length} POV
            {state.stalledPovIds.length === 1 ? '' : 's'} to buffer…
          </span>
        )}
      </div>

      <div
        className="scrub-row"
        onPointerMove={trackHover}
        onPointerLeave={() => setHoverMs(undefined)}
      >
        {hoverMs !== undefined && (
          <div className="hover-readout" aria-hidden="true" style={{ left: percent(hoverMs) }}>
            {/*
              Shifting the chip by its own position rather than a flat half
              width keeps it inside the bar at both ends: centred in the middle,
              flush left at 0:00, flush right at the end. Centring throughout
              hangs it off the edge, where the sidebar clips it.
            */}
            <span
              className="hover-time"
              style={{ transform: `translateX(-${ratio(hoverMs)}%)` }}
            >
              {formatTime(hoverMs)}
            </span>
            <span className="hover-line" />
          </div>
        )}

        {/*
          Deaths are hairlines inside the track, and are themselves what you
          click to jump — there is no separate row of pips to hit any more.

          Uniformly red: the question this bar answers is "when did people die",
          and colouring each by class made a wall of shifting colours that was
          harder to read, not easier. Who died is in the tooltip.
        */}
        <div className="death-strip">
          {deaths.map((death) => (
            <button
              key={death.id}
              className="death-line"
              style={{ left: percent(death.atMs) }}
              title={`${death.playerName} died at ${formatTime(death.atMs)}${
                death.killingBlow ? ` — ${death.killingBlow}` : ''
              } (jumps ${DEATH_LEAD_MS / 1000}s before)`}
              onClick={() => engine.seekTo(Math.max(0, death.atMs - DEATH_LEAD_MS))}
            />
          ))}
        </div>

        <input
          type="range"
          min={0}
          max={max}
          step={100}
          value={shown}
          // How much of the track is painted as elapsed. A custom property
          // because the fill lives in the track pseudo-element, which inline
          // styles cannot otherwise reach.
          style={{ '--fill': percent(shown) } as CSSProperties}
          aria-label="Timeline position"
          onChange={(e) => setScrubMs(Number(e.target.value))}
          onPointerUp={() => {
            if (scrubMs !== undefined) engine.seekTo(scrubMs)
            setScrubMs(undefined)
          }}
          onKeyUp={() => {
            if (scrubMs !== undefined) engine.seekTo(scrubMs)
            setScrubMs(undefined)
          }}
        />

        {/* Bookmarks stay below the bar: they are yours, not the log's. */}
        <div className="pip-strip">
          {markers.map((marker) => (
            <button
              key={marker.id}
              className="marker-pip"
              style={{ left: percent(marker.atMs) }}
              title={`${marker.label} — ${formatTime(marker.atMs)}`}
              onClick={() => onSeekMarker(marker)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
