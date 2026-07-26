import { useEffect, useRef, useState } from 'react'
import type { VodPov } from '../core/types'
import type { TimelineEngine } from '../core/timeline'
import { createPlayer, PlayerError, UNAVAILABLE_MESSAGES } from '../players'
import type { PovPlayer } from '../players/types'
import { MenuButton } from './MenuButton'
import { formatPrecise } from '../core/format'

interface Props {
  pov: VodPov
  engine: TimelineEngine
  isAudio: boolean
  isStalled: boolean
  onMakeAudio(): void
  onSyncHere(): void
  onNudgeOffset(deltaMs: number): void
  onRename(): void
  onRemove(): void
  onUnavailable(reason: NonNullable<VodPov['unavailableReason']>): void
}

/**
 * One POV: the embedded player plus its per-POV controls.
 *
 * The iframe is mounted into a plain div that React never re-renders into —
 * both SDKs take over their container element, so anything React tried to
 * reconcile inside it would be clobbered.
 */
export function PovTile({
  pov,
  engine,
  isAudio,
  isStalled,
  onMakeAudio,
  onSyncHere,
  onNudgeOffset,
  onRename,
  onRemove,
  onUnavailable,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)

  // Deliberately keyed on identity + video only. Re-running this on offset
  // changes would tear down and rebuild the iframe every time the user nudges
  // the sync point, which is exactly when they need it to stay put.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let player: PovPlayer | undefined
    setLoading(true)
    setError(undefined)

    void (async () => {
      try {
        const created = await createPlayer(pov, container, pov.offsetMs / 1000, {
          onStateChange: () => {},
        })
        player = created
        await created.ready
        if (cancelled) {
          created.destroy()
          return
        }
        setLoading(false)
        engine.registerPlayer(
          pov.id,
          created,
          pov.offsetMs,
          pov.platform === 'youtube',
        )
      } catch (caught) {
        if (cancelled) return
        setLoading(false)
        if (caught instanceof PlayerError) {
          setError(UNAVAILABLE_MESSAGES[caught.reason])
          onUnavailable(caught.reason)
        } else {
          setError(caught instanceof Error ? caught.message : 'This video failed to load.')
        }
      }
    })()

    return () => {
      cancelled = true
      engine.unregisterPlayer(pov.id)
      player?.destroy()
      container.replaceChildren()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pov.id, pov.platform, pov.videoId, engine])

  // Offset changes are pushed to the running player instead of remounting it.
  useEffect(() => {
    engine.setOffset(pov.id, pov.offsetMs)
  }, [engine, pov.id, pov.offsetMs])

  return (
    <div className={`pov-tile${isAudio ? ' is-audio' : ''}${isStalled ? ' is-stalled' : ''}`}>
      <div className="pov-header">
        <button
          className={`audio-toggle${isAudio ? ' active' : ''}`}
          title={isAudio ? 'This POV is audible' : 'Listen to this POV'}
          onClick={onMakeAudio}
          disabled={!!error}
        >
          {isAudio ? '🔊' : '🔇'}
        </button>

        <span className="pov-label" title={pov.label}>
          {pov.label || 'Unnamed POV'}
        </span>

        {/*
          Nudging this POV's offset is how alignment actually gets fixed. Every
          POV is locked to the shared timeline, so there is no way to scrub one
          on its own — instead you watch, see this angle running early or late,
          and pull it back by that much. Negative delta moves the video earlier.
        */}
        <span className="pov-sync">
          <button
            className="nudge"
            title="This POV is running late — pull it 1s earlier"
            onClick={() => onNudgeOffset(-1000)}
            disabled={!!error}
          >
            −1s
          </button>
          <button
            className="nudge"
            title="Fine: 0.1s earlier"
            onClick={() => onNudgeOffset(-100)}
            disabled={!!error}
          >
            −
          </button>
          <span className="pov-offset" title="Timeline zero falls at this point in the video">
            {formatPrecise(pov.offsetMs)}
          </span>
          <button
            className="nudge"
            title="Fine: 0.1s later"
            onClick={() => onNudgeOffset(100)}
            disabled={!!error}
          >
            +
          </button>
          <button
            className="nudge"
            title="This POV is running early — push it 1s later"
            onClick={() => onNudgeOffset(1000)}
            disabled={!!error}
          >
            +1s
          </button>
        </span>

        <MenuButton
          actions={[
            {
              label: 'Sync here',
              onSelect: onSyncHere,
              disabled: !!error,
            },
            { label: 'Reset offset to 0', onSelect: () => onNudgeOffset(-pov.offsetMs) },
            { label: 'Rename…', onSelect: onRename },
            {
              label: 'Remove POV',
              onSelect: onRemove,
              destructive: true,
              confirm: `Remove "${pov.label || 'this POV'}" from the review?`,
            },
          ]}
        />
      </div>

      <div className="pov-video">
        <div ref={containerRef} className="pov-mount" />
        {loading && !error && <div className="pov-overlay">Loading…</div>}
        {error && (
          <div className="pov-overlay pov-error">
            <strong>Can't play this video</strong>
            <p>{error}</p>
          </div>
        )}
        {isStalled && !error && <div className="pov-badge">Buffering</div>}
      </div>
    </div>
  )
}
