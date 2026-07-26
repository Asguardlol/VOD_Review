import { useState } from 'react'
import type { TimelineEngine, TimelineState } from '../core/timeline'
import type { VodMarker } from '../core/types'
import { formatTime } from '../core/format'

interface Props {
  engine: TimelineEngine
  state: TimelineState
  markers: VodMarker[]
  durationMs: number
  onAddMarker(): void
  onSeekMarker(marker: VodMarker): void
}

/** Step sizes for frame-ish nudging. Both platforms are far too coarse for real
 * frame stepping, so these are the smallest steps that reliably land. */
const NUDGE_MS = 1000
const JUMP_MS = 10_000

export function TransportBar({
  engine,
  state,
  markers,
  durationMs,
  onAddMarker,
  onSeekMarker,
}: Props) {
  // While dragging, the scrubber shows the dragged value rather than the
  // engine's — otherwise the tick fights the user's thumb every 400ms.
  const [scrubMs, setScrubMs] = useState<number | undefined>()
  const shown = scrubMs ?? state.positionMs
  const max = Math.max(durationMs, state.positionMs, 1)

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
          {formatTime(shown)} <span className="dim">/ {formatTime(durationMs)}</span>
        </span>

        <button onClick={onAddMarker} title="Bookmark this moment">
          + Marker
        </button>

        {state.stalled && (
          <span className="stall-notice" title="Everything is held so the angles stay aligned">
            Waiting for {state.stalledPovIds.length} POV
            {state.stalledPovIds.length === 1 ? '' : 's'} to buffer…
          </span>
        )}
      </div>

      <div className="scrub-row">
        <input
          type="range"
          min={0}
          max={max}
          step={100}
          value={shown}
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
        {markers.length > 0 && (
          <div className="marker-strip">
            {markers.map((marker) => (
              <button
                key={marker.id}
                className="marker-pip"
                style={{ left: `${(marker.atMs / max) * 100}%` }}
                title={`${marker.label} — ${formatTime(marker.atMs)}`}
                onClick={() => onSeekMarker(marker)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
