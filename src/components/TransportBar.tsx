import { useState } from 'react'
import type { TimelineEngine, TimelineState } from '../core/timeline'
import type { VodDeath, VodMarker } from '../core/types'
import { formatTime } from '../core/format'
import { CLASS_COLORS } from '../core/classColors'

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
  const shown = scrubMs ?? state.positionMs
  const max = Math.max(durationMs, state.positionMs, 1)
  const percent = (ms: number) => `${Math.min(100, Math.max(0, (ms / max) * 100))}%`

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

      <div className="scrub-row">
        {/*
          Deaths sit behind the range input so the thumb stays grabbable. They
          are the main thing being read off this bar, so they get the strongest
          treatment: a full-height line in the player's class colour.
        */}
        <div className="death-strip" aria-hidden="true">
          {deaths.map((death) => (
            <span
              key={death.id}
              className="death-line"
              style={{
                left: percent(death.atMs),
                background: death.wowClass ? CLASS_COLORS[death.wowClass] : undefined,
              }}
            />
          ))}
        </div>

        <input
          type="range"
          min={0}
          max={max}
          step={100}
          value={shown}
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

        <div className="pip-strip">
          {deaths.map((death) => (
            <button
              key={death.id}
              className="death-pip"
              style={{
                left: percent(death.atMs),
                background: death.wowClass ? CLASS_COLORS[death.wowClass] : undefined,
              }}
              title={`${death.playerName} died at ${formatTime(death.atMs)}${
                death.killingBlow ? ` — ${death.killingBlow}` : ''
              } (jumps ${DEATH_LEAD_MS / 1000}s before)`}
              onClick={() => engine.seekTo(Math.max(0, death.atMs - DEATH_LEAD_MS))}
            />
          ))}
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
