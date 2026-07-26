import { useEffect, useRef, useState } from 'react'
import type { ResolvedVod, VodStream } from '../core/types'
import type { TimelineEngine } from '../core/timeline'
import { createPlayer, PlayerError, UNAVAILABLE_MESSAGES, supportsPlaybackRate } from '../players'
import type { PovPlayer } from '../players/types'
import { MenuButton } from './MenuButton'

interface Props {
  stream: VodStream
  vod: ResolvedVod
  /** Where pull start falls inside this VOD, in ms. */
  timelineOffsetMs: number
  engine: TimelineEngine
  isAudio: boolean
  isStalled: boolean
  onMakeAudio(): void
  onNudgeDelay(deltaMs: number): void
  onEdit(): void
  onRemove(): void
  onUnavailable(reason: NonNullable<VodStream['unavailableReason']>): void
}

/**
 * One stream's player.
 *
 * The iframe mounts into a plain div React never reconciles into — both SDKs
 * take over their container element, so anything React rendered inside would be
 * clobbered.
 */
export function StreamTile({
  stream,
  vod,
  timelineOffsetMs,
  engine,
  isAudio,
  isStalled,
  onMakeAudio,
  onNudgeDelay,
  onEdit,
  onRemove,
  onUnavailable,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)

  // Keyed on the video only. Re-running this when the delay changes would tear
  // down and rebuild the iframe every time the user nudges sync — exactly when
  // it needs to stay put.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let player: PovPlayer | undefined
    setLoading(true)
    setError(undefined)

    void (async () => {
      try {
        const created = await createPlayer(
          stream.id,
          vod,
          container,
          Math.max(0, timelineOffsetMs / 1000),
        )
        player = created
        await created.ready
        if (cancelled) {
          created.destroy()
          return
        }
        setLoading(false)
        engine.registerPlayer(stream.id, created, timelineOffsetMs, supportsPlaybackRate(vod))
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
      engine.unregisterPlayer(stream.id)
      player?.destroy()
      container.replaceChildren()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.id, vod.platform, vod.videoId, engine])

  // Offset changes are pushed to the running player instead of remounting it.
  useEffect(() => {
    engine.setOffset(stream.id, timelineOffsetMs)
  }, [engine, stream.id, timelineOffsetMs])

  return (
    <div className={`pov-tile${isAudio ? ' is-audio' : ''}${isStalled ? ' is-stalled' : ''}`}>
      <div className="pov-header">
        <button
          className={`audio-toggle${isAudio ? ' active' : ''}`}
          title={isAudio ? 'This stream is audible' : 'Listen to this stream'}
          onClick={onMakeAudio}
          disabled={!!error}
        >
          {isAudio ? '🔊' : '🔇'}
        </button>

        <span className="pov-label" title={vod.title ?? stream.label}>
          {stream.label}
        </span>

        {/*
          Broadcast delay, not a per-pull offset. Set it once for the night and
          every pull in the report lines up — so this is a property of the
          streamer, which is why it reads in milliseconds like Twitch's own
          delay figure rather than as a timeline position.
        */}
        <span className="pov-sync">
          <button
            className="nudge"
            title="Running late — reduce this stream's delay by 500ms"
            onClick={() => onNudgeDelay(-500)}
            disabled={!!error}
          >
            −
          </button>
          <span className="pov-offset" title="Broadcast delay">
            {stream.offsetMs} ms
          </span>
          <button
            className="nudge"
            title="Running early — increase this stream's delay by 500ms"
            onClick={() => onNudgeDelay(500)}
            disabled={!!error}
          >
            +
          </button>
        </span>

        <MenuButton
          actions={[
            { label: 'Edit stream…', onSelect: onEdit },
            {
              label: 'Remove stream',
              onSelect: onRemove,
              destructive: true,
              confirm: `Remove "${stream.label}" from this session?`,
            },
          ]}
        />
      </div>

      <div className="pov-video">
        <div ref={containerRef} className="pov-mount" />
        {loading && !error && <div className="pov-overlay">Loading…</div>}
        {error && (
          <div className="pov-overlay pov-error">
            <strong>Can't play this stream</strong>
            <p>{error}</p>
          </div>
        )}
        {isStalled && !error && <div className="pov-badge">Buffering</div>}
      </div>
    </div>
  )
}
