import { useCallback, useEffect, useState } from 'react'
import type { SessionStore, SessionSummary } from '../core/storage'
import { MenuButton } from './MenuButton'
import { formatAge } from '../core/format'

interface Props {
  store: SessionStore
  onOpen(id: string): void
}

/**
 * Past sessions.
 *
 * Deliberately not the landing screen — you land on a working surface, and this
 * is reached from the menu when you want a previous night. Naming a session up
 * front was ceremony that got in the way of pasting a log.
 */
export function SessionPicker({ store, onOpen }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setSessions(await store.listSessions())
    setLoading(false)
  }, [store])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="review-list">
      <header className="review-header">
        <h1>Sessions</h1>
        <button
          className="primary"
          onClick={() => void store.createSession().then((s) => onOpen(s.id))}
        >
          New session
        </button>
      </header>

      {loading ? (
        <p className="pad">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="empty">No sessions yet.</p>
      ) : (
        <ul className="review-items">
          {sessions.map((s) => (
            <li key={s.id}>
              <button className="review-open" onClick={() => onOpen(s.id)}>
                <span className="review-title">{s.title}</span>
                <span className="dim">
                  {s.streamCount} stream{s.streamCount === 1 ? '' : 's'}
                  {s.reportCode ? ` · ${s.reportCode}` : ''} · {formatAge(s.updatedAt)}
                </span>
              </button>
              <MenuButton
                actions={[
                  {
                    label: 'Delete session',
                    destructive: true,
                    confirm: `Delete "${s.title}"? This cannot be undone.`,
                    onSelect: () => {
                      void store.deleteSession(s.id).then(refresh)
                    },
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      <footer className="storage-note">
        Sessions are stored in this browser only — there is no server. Use Share
        or Download JSON to move one somewhere else.
      </footer>
    </div>
  )
}
