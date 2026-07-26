import { useState } from 'react'
import type { StreamRole, VodStream, WowClass } from '../core/types'
import { CLASS_COLORS } from '../core/classColors'
import { DEFAULT_BROADCAST_DELAY_MS } from '../core/sync'
import { MenuButton } from './MenuButton'

interface Props {
  streams: VodStream[]
  watching: string[]
  maxWatching: number
  audioStreamId?: string
  /** Present once a report is loaded; drives the greying-out. */
  hasReport: boolean
  onToggleWatch(streamId: string): void
  onSoloWatch(streamId: string): void
  onAdd(draft: StreamDraft): void
  onEdit(stream: VodStream, draft: StreamDraft): void
  onRemove(streamId: string): void
  onImport(file: File): void
  onExport(): void
}

export interface StreamDraft {
  channel: string
  label: string
  role?: StreamRole
  wowClass?: WowClass
  offsetMs: number
}

const ROLE_LABELS: Record<StreamRole, string> = {
  tank: 'Tank',
  healer: 'Healer',
  mdps: 'MDPS',
  rdps: 'RDPS',
}

const ROLE_GLYPHS: Record<StreamRole, string> = {
  tank: '🛡',
  healer: '✚',
  mdps: '⚔',
  rdps: '🏹',
}

const CLASSES: WowClass[] = [
  'death-knight',
  'demon-hunter',
  'druid',
  'evoker',
  'hunter',
  'mage',
  'monk',
  'paladin',
  'priest',
  'rogue',
  'shaman',
  'warlock',
  'warrior',
]

/**
 * The stream list, and the form for adding one.
 *
 * A stream is a person and their channel, not a video: type a name once and the
 * app finds whichever VOD covers the report. Streams with no usable VOD are
 * greyed rather than hidden — "they didn't stream that night" is information
 * worth showing, and hiding them would look like the app lost them.
 */
export function StreamSidebar({
  streams,
  watching,
  maxWatching,
  audioStreamId,
  hasReport,
  onToggleWatch,
  onSoloWatch,
  onAdd,
  onEdit,
  onRemove,
  onImport,
  onExport,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<VodStream | undefined>()
  const atCapacity = watching.length >= maxWatching

  return (
    <div className="stream-panel">
      <ul className="stream-list">
        {streams.map((stream) => {
          const usable = !!stream.resolved || stream.source.kind === 'video'
          const isWatching = watching.includes(stream.id)
          return (
            <li
              key={stream.id}
              className={`${isWatching ? 'watching ' : ''}${usable ? '' : 'unusable'}`}
            >
              <input
                type="checkbox"
                checked={isWatching}
                // Capacity blocks adding, never removing — otherwise you hit the
                // limit and can no longer uncheck anything.
                disabled={(!isWatching && atCapacity) || !usable}
                title={
                  !usable
                    ? describeUnusable(stream, hasReport)
                    : !isWatching && atCapacity
                      ? `Already watching ${maxWatching}. Uncheck one first.`
                      : isWatching
                        ? 'Stop watching'
                        : 'Watch alongside'
                }
                onChange={() => onToggleWatch(stream.id)}
              />

              <span
                className="role-icon"
                style={{ color: stream.wowClass ? CLASS_COLORS[stream.wowClass] : undefined }}
                title={stream.role ? ROLE_LABELS[stream.role] : 'No role set'}
              >
                {stream.role ? ROLE_GLYPHS[stream.role] : '●'}
              </span>

              <button
                className="sidebar-pov-name"
                title={usable ? 'Show only this stream' : describeUnusable(stream, hasReport)}
                onClick={() => usable && onSoloWatch(stream.id)}
              >
                {stream.label}
                {audioStreamId === stream.id && <span className="dim"> 🔊</span>}
              </button>

              <MenuButton
                actions={[
                  { label: 'Edit…', onSelect: () => setEditing(stream) },
                  {
                    label: 'Remove stream',
                    destructive: true,
                    confirm: `Remove "${stream.label}" from this session?`,
                    onSelect: () => onRemove(stream.id),
                  },
                ]}
              />
            </li>
          )
        })}
      </ul>

      {(adding || editing) && (
        <StreamForm
          initial={editing}
          onCancel={() => {
            setAdding(false)
            setEditing(undefined)
          }}
          onSubmit={(draft) => {
            if (editing) onEdit(editing, draft)
            else onAdd(draft)
            setAdding(false)
            setEditing(undefined)
          }}
        />
      )}

      {!adding && !editing && (
        <div className="stream-actions">
          <button className="primary" onClick={() => setAdding(true)}>
            + New stream
          </button>
          <label className="import-button">
            Import
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onImport(file)
                e.target.value = ''
              }}
            />
          </label>
          <button onClick={onExport} disabled={streams.length === 0}>
            Export
          </button>
        </div>
      )}
    </div>
  )
}

function describeUnusable(stream: VodStream, hasReport: boolean): string {
  if (!hasReport) return 'Paste a report below — VODs are matched to its time range.'
  switch (stream.unavailableReason) {
    case 'channel-not-found':
      return 'No Twitch channel by that name.'
    case 'no-vod-in-range':
      return "This channel has no VOD covering the report's time range — they " +
        'either did not stream, or the VOD has since expired.'
    case 'vod-expired':
      return 'The VOD expired. Plain Twitch VODs last ~14 days (60 for Partners).'
    default:
      return 'No video found for this stream yet.'
  }
}

function StreamForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: VodStream
  onCancel(): void
  onSubmit(draft: StreamDraft): void
}) {
  const [channel, setChannel] = useState(
    initial?.source.kind === 'twitch-channel' ? initial.source.login : '',
  )
  const [label, setLabel] = useState(initial?.label ?? '')
  const [role, setRole] = useState<StreamRole | ''>(initial?.role ?? '')
  const [wowClass, setWowClass] = useState<WowClass | ''>(initial?.wowClass ?? '')
  const [offsetMs, setOffsetMs] = useState(initial?.offsetMs ?? DEFAULT_BROADCAST_DELAY_MS)

  return (
    <form
      className="stream-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!channel.trim()) return
        onSubmit({
          channel: channel.trim(),
          label: label.trim() || channel.trim(),
          role: role || undefined,
          wowClass: wowClass || undefined,
          offsetMs,
        })
      }}
    >
      <label>
        <span>Twitch</span>
        <input
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          placeholder="Twitch username or channel url"
          autoFocus
        />
      </label>

      <label>
        <span>Name</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Display name"
        />
      </label>

      <label>
        <span>Role</span>
        <select value={role} onChange={(e) => setRole(e.target.value as StreamRole | '')}>
          <option value="">—</option>
          {(Object.keys(ROLE_LABELS) as StreamRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Class</span>
        <select
          value={wowClass}
          onChange={(e) => setWowClass(e.target.value as WowClass | '')}
          style={{ color: wowClass ? CLASS_COLORS[wowClass] : undefined }}
        >
          <option value="">—</option>
          {CLASSES.map((c) => (
            <option key={c} value={c}>
              {c.replace('-', ' ')}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Offset</span>
        <span className="offset-field">
          <input
            type="number"
            step={100}
            value={offsetMs}
            onChange={(e) => setOffsetMs(Number(e.target.value))}
          />
          <span className="dim">ms</span>
        </span>
      </label>

      <div className="form-buttons">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary">
          {initial ? 'Save' : 'Add stream'}
        </button>
      </div>
    </form>
  )
}
