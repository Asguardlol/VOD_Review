import { useState } from 'react'
import type { StreamRole, VodGuild, VodStream, WowClass } from '../core/types'
import { CLASS_COLORS } from '../core/classColors'
import { DEFAULT_BROADCAST_DELAY_MS } from '../core/sync'
import { MenuButton } from './MenuButton'

interface Props {
  streams: VodStream[]
  guilds: VodGuild[]
  watching: string[]
  maxWatching: number
  audioStreamId?: string
  /** Present once a report is loaded; drives the greying-out. */
  hasReport: boolean
  onToggleWatch(streamId: string): void
  onSoloWatch(streamId: string): void
  onMakeAudio(streamId: string): void
  /** Puts the whole guild on screen, or takes it off. */
  onToggleGuildWatch(guildId: string): void
  onAdd(draft: StreamDraft): void
  onEdit(stream: VodStream, draft: StreamDraft): void
  onRemove(streamId: string): void
  onDuplicate(stream: VodStream): void
  onMoveToGuild(streamId: string, guildId: string | undefined): void
  onAddGuild(): void
  onRenameGuild(guild: VodGuild): void
  onRemoveGuild(guildId: string): void
  /** Opens the paste box. The parent owns what pasted text means. */
  onImport(): void
  /** The roster as JSON, for the clipboard. */
  rosterJson(): string
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

const DRAG_TYPE = 'application/x-vod-stream-id'

/**
 * The stream list, grouped into guilds.
 *
 * A guild behaves as one entity that happens to contain several people:
 * ticking it puts its members on screen, unticking takes them off. It is not a
 * filter and it is not exclusive — individuals inside or outside any guild can
 * still be picked freely, and the only limit is the overall cap on how many
 * play at once.
 *
 * Sections start collapsed. A raid night is a lot of names, and the point of
 * grouping is to make that list short enough to scan.
 *
 * People are assigned by dragging them between sections. Someone who should
 * appear both inside a guild and on their own can be duplicated first.
 */
export function StreamSidebar({
  streams,
  guilds,
  watching,
  maxWatching,
  audioStreamId,
  hasReport,
  onToggleWatch,
  onSoloWatch,
  onMakeAudio,
  onToggleGuildWatch,
  onAdd,
  onEdit,
  onRemove,
  onDuplicate,
  onMoveToGuild,
  onAddGuild,
  onRenameGuild,
  onRemoveGuild,
  onImport,
  rosterJson,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<VodStream | undefined>()
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /**
   * Tracks what is *open* rather than what is closed, so guilds created later
   * start collapsed too without anyone having to remember to add them.
   */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const atCapacity = watching.length >= maxWatching
  const ungrouped = streams.filter((s) => !s.guildId)

  /**
   * The tick is the only signal the copy happened — this replaced a file
   * download, which announced itself. If the browser refuses the write the JSON
   * goes in a prompt, so the roster is still recoverable by hand.
   */
  const copyRoster = () => {
    const json = rosterJson()
    void navigator.clipboard.writeText(json).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      },
      () => window.prompt('Copy this roster', json),
    )
  }

  const toggleExpanded = (guildId: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(guildId)) next.delete(guildId)
      else next.add(guildId)
      return next
    })

  const renderStream = (stream: VodStream) => {
    const selectable = !!stream.resolved || stream.source.kind === 'video'
    const isWatching = watching.includes(stream.id)

    return (
      <li
        key={stream.id}
        className={`${isWatching ? 'watching ' : ''}${selectable ? '' : 'unusable'}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, stream.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
      >
        <input
          type="checkbox"
          checked={isWatching}
          // Capacity blocks adding, never removing — otherwise you hit the limit
          // and can no longer uncheck anything.
          disabled={(!isWatching && atCapacity) || !selectable}
          title={
            !selectable
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
          title={selectable ? 'Show only this stream' : describeUnusable(stream, hasReport)}
          onClick={() => selectable && onSoloWatch(stream.id)}
        >
          {stream.label}
          {audioStreamId === stream.id && <span className="dim"> 🔊</span>}
        </button>

        <MenuButton
          actions={[
            {
              label:
                audioStreamId === stream.id
                  ? 'Already the audible stream'
                  : 'Listen to this stream',
              onSelect: () => onMakeAudio(stream.id),
              disabled: audioStreamId === stream.id || !selectable,
            },
            { label: 'Edit…', onSelect: () => setEditing(stream) },
            {
              // Lets one person sit inside a guild and also stand alone — drag
              // the copy where you want it.
              label: 'Duplicate',
              onSelect: () => onDuplicate(stream),
            },
            ...(stream.guildId
              ? [
                  {
                    label: 'Remove from guild',
                    onSelect: () => onMoveToGuild(stream.id, undefined),
                  },
                ]
              : []),
            {
              label: 'Delete stream',
              destructive: true,
              confirm: `Remove "${stream.label}" from this session?`,
              onSelect: () => onRemove(stream.id),
            },
          ]}
        />
      </li>
    )
  }

  const dropProps = (guildId: string | undefined, key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move' as const
      setDropTarget(key)
    },
    onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDropTarget(null)
      const id = e.dataTransfer.getData(DRAG_TYPE)
      if (id) onMoveToGuild(id, guildId)
    },
  })

  return (
    <div className="stream-panel">
      {guilds.map((guild) => {
        const members = streams.filter((s) => s.guildId === guild.id)
        const withVod = members.filter((s) => s.resolved || s.source.kind === 'video')
        const watchedHere = withVod.filter((s) => watching.includes(s.id))
        const allOn = withVod.length > 0 && watchedHere.length === withVod.length
        const someOn = watchedHere.length > 0 && !allOn
        const isOpen = expanded.has(guild.id)

        return (
          <section
            key={guild.id}
            className={`guild-section${dropTarget === guild.id ? ' drop-target' : ''}`}
            {...dropProps(guild.id, guild.id)}
          >
            <h3>
              <input
                type="checkbox"
                checked={allOn}
                // Partial selection is its own state: "some of this guild is up"
                // is different from "none of it is", and a plain unchecked box
                // would claim the latter.
                ref={(el) => {
                  if (el) el.indeterminate = someOn
                }}
                disabled={withVod.length === 0}
                onChange={() => onToggleGuildWatch(guild.id)}
                title={
                  withVod.length === 0
                    ? 'Nobody in this guild has a VOD for this report'
                    : allOn
                      ? 'Take this guild off screen'
                      : `Put this guild on screen (up to ${maxWatching})`
                }
              />

              <button
                className="guild-name"
                onClick={() => toggleExpanded(guild.id)}
                title={isOpen ? 'Collapse' : 'Expand'}
              >
                <span className="chevron">{isOpen ? '⌄' : '›'}</span>
                <span
                  className="guild-swatch"
                  style={guild.color ? { background: guild.color } : undefined}
                />
                {guild.name}
                <span className="dim" title="Members with a VOD covering this report">
                  {' '}
                  ({withVod.length}/{members.length})
                </span>
              </button>

              <MenuButton
                actions={[
                  { label: 'Rename guild…', onSelect: () => onRenameGuild(guild) },
                  {
                    label: 'Delete guild',
                    destructive: true,
                    // Deleting a group must never destroy footage. Members fall
                    // back to ungrouped, which is recoverable; losing them isn't.
                    confirm: `Delete guild "${guild.name}"? Its ${members.length} member${
                      members.length === 1 ? '' : 's'
                    } move to Ungrouped, they are not deleted.`,
                    onSelect: () => onRemoveGuild(guild.id),
                  },
                ]}
              />
            </h3>

            {/* Collapsed guilds still accept drops, so assigning doesn't
                require expanding everything first. */}
            {isOpen &&
              (members.length === 0 ? (
                <p className="sidebar-empty dim">Drag people here</p>
              ) : (
                <ul>{members.map(renderStream)}</ul>
              ))}
          </section>
        )
      })}

      <section
        className={`guild-section${dropTarget === '__none__' ? ' drop-target' : ''}`}
        {...dropProps(undefined, '__none__')}
      >
        {guilds.length > 0 && (
          <h3>
            Ungrouped<span className="dim"> ({ungrouped.length})</span>
          </h3>
        )}
        {ungrouped.length === 0 ? (
          guilds.length > 0 && <p className="sidebar-empty dim">Drag people here</p>
        ) : (
          <ul>{ungrouped.map(renderStream)}</ul>
        )}
      </section>

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
          <button onClick={onAddGuild}>+ Guild</button>
          <button onClick={onImport}>Paste roster</button>
          <button onClick={copyRoster} disabled={streams.length === 0}>
            {copied ? 'Copied ✓' : 'Copy roster'}
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
      return (
        "This channel has no VOD covering the report's time range — they " +
        'either did not stream, or the VOD has since expired.'
      )
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
