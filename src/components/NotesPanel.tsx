import { useState } from 'react'
import type { VodMarker } from '../core/types'
import { formatTime, parseTimeInput } from '../core/format'
import { MenuButton } from './MenuButton'

interface Props {
  markers: VodMarker[]
  /** Where the transport is now, for the "add here" button. */
  positionMs: number
  /** True when a pull is loaded. Notes hang off a pull, not off the session. */
  hasPull: boolean
  onSeek(marker: VodMarker): void
  onAdd(atMs: number, label: string): void
  onEdit(id: string, label: string, note: string | undefined, atMs: number): void
  onRemove(id: string): void
  onClose(): void
}

/**
 * Notes on the pull, as a timestamped list.
 *
 * The model is a YouTube chapter list: a time, a line about what happened, and
 * clicking it takes every angle there. That is what a review actually produces
 * — "3:40 second breath, melee too slow to move" — and until now the only place
 * to put it was a marker label, which showed up as a pip you had to hover to
 * read. A list you can scan is the point.
 *
 * Sorted by time rather than by when they were written, because the artifact
 * being built is a walkthrough of the pull.
 */
export function NotesPanel({
  markers,
  positionMs,
  hasPull,
  onSeek,
  onAdd,
  onEdit,
  onRemove,
  onClose,
}: Props) {
  const [draft, setDraft] = useState('')
  /**
   * A typed-in time, or undefined to follow the playhead.
   *
   * Following by default is what you want while watching — you stop at the
   * moment and write about it. But the playhead is at 0:00 whenever nothing is
   * loaded, so without a way to type the time every note piled up at zero.
   */
  const [timeDraft, setTimeDraft] = useState<string | undefined>()
  const [editing, setEditing] = useState<string | undefined>()
  const [editLabel, setEditLabel] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editTime, setEditTime] = useState('')

  const sorted = [...markers].sort((a, b) => a.atMs - b.atMs)

  const shownTime = timeDraft ?? formatTime(positionMs)
  const draftAtMs = timeDraft === undefined ? Math.round(positionMs) : parseTimeInput(timeDraft)

  const submitDraft = () => {
    const label = draft.trim()
    if (!label || draftAtMs === undefined) return
    onAdd(draftAtMs, label)
    setDraft('')
    // Back to following the playhead: the next note is usually about wherever
    // you have got to, not about the time you just typed.
    setTimeDraft(undefined)
  }

  const startEdit = (marker: VodMarker) => {
    setEditing(marker.id)
    setEditLabel(marker.label)
    setEditNote(marker.note ?? '')
    setEditTime(formatTime(marker.atMs))
  }

  const commitEdit = () => {
    if (!editing) return
    const label = editLabel.trim()
    const atMs = parseTimeInput(editTime)
    if (label && atMs !== undefined) {
      onEdit(editing, label, editNote.trim() || undefined, atMs)
    }
    setEditing(undefined)
  }

  return (
    <aside className="notes-panel">
      <header className="notes-header">
        <h2>Notes</h2>
        <button className="icon-button" onClick={onClose} title="Hide notes">
          ✕
        </button>
      </header>

      {!hasPull ? (
        <p className="sidebar-empty dim">Pick a pull to take notes on it.</p>
      ) : (
        <>
          <div className="note-compose">
            <input
              className={`note-time-input${draftAtMs === undefined ? ' invalid' : ''}`}
              value={shownTime}
              aria-label="Time for this note"
              title="Follows the playhead until you type a time. m:ss or h:mm:ss."
              onChange={(e) => setTimeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitDraft()
                if (e.key === 'Escape') setTimeDraft(undefined)
              }}
            />
            <input
              value={draft}
              placeholder="What happened?"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitDraft()
              }}
            />
            <button onClick={submitDraft} disabled={!draft.trim() || draftAtMs === undefined}>
              Add
            </button>
          </div>

          {sorted.length === 0 ? (
            <p className="sidebar-empty dim">
              No notes on this pull yet. Scrub to a moment, type what happened, and it
              lands here with its timestamp — and travels with the share link.
            </p>
          ) : (
            <ol className="note-list">
              {sorted.map((marker) => (
                <li key={marker.id} className="note-item">
                  {editing === marker.id ? (
                    <div className="note-edit">
                      <div className="note-edit-row">
                        <input
                          className={`note-time-input${
                            parseTimeInput(editTime) === undefined ? ' invalid' : ''
                          }`}
                          value={editTime}
                          aria-label="Time"
                          onChange={(e) => setEditTime(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit()
                            if (e.key === 'Escape') setEditing(undefined)
                          }}
                        />
                        <input
                          value={editLabel}
                          aria-label="Note"
                          onChange={(e) => setEditLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit()
                            if (e.key === 'Escape') setEditing(undefined)
                          }}
                        />
                      </div>
                      <textarea
                        value={editNote}
                        rows={2}
                        placeholder="More detail (optional)"
                        aria-label="Detail"
                        onChange={(e) => setEditNote(e.target.value)}
                      />
                      <div className="note-edit-actions">
                        <button onClick={commitEdit}>Save</button>
                        <button onClick={() => setEditing(undefined)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/*
                        The timestamp is the link, the way it is in a YouTube
                        description — clicking it takes every angle to that moment.
                      */}
                      <button
                        className="note-seek"
                        onClick={() => onSeek(marker)}
                        title="Jump every stream here"
                      >
                        <span className="note-time">{formatTime(marker.atMs)}</span>
                        <span className="note-label">{marker.label}</span>
                      </button>
                      {marker.note && <p className="note-detail dim">{marker.note}</p>}
                      <MenuButton
                        actions={[
                          { label: 'Edit…', onSelect: () => startEdit(marker) },
                          {
                            label: 'Delete note',
                            destructive: true,
                            confirm: `Delete "${marker.label}"?`,
                            onSelect: () => onRemove(marker.id),
                          },
                        ]}
                      />
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </aside>
  )
}
