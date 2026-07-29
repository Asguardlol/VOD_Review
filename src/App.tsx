import { useCallback, useEffect, useMemo, useState } from 'react'
import { LocalSessionStore } from './core/localStore'
import { SessionView } from './components/SessionView'
import { SessionPicker } from './components/SessionPicker'
import { adoptSharedSession, decodeSession, type ShareAdoption } from './core/share'
import { formatAge } from './core/format'
import type { VodSession } from './core/types'
import './App.css'

/**
 * Hash-based routing.
 *
 * GitHub Pages has no rewrite rules, so a path-based deep link would 404 before
 * the app ever loaded. Everything after `#` is ours:
 *   #/                     the working surface (most recent session)
 *   #/session/<id>         a specific session
 *   #/sessions             past sessions
 *   #/shared/<payload>     a session encoded into the link itself
 */
type Route =
  | { kind: 'current' }
  | { kind: 'session'; id: string }
  | { kind: 'picker' }
  | { kind: 'shared'; payload: string }

function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const session = /^\/session\/(.+)$/.exec(path)
  if (session) return { kind: 'session', id: session[1] }
  const shared = /^\/shared\/(.+)$/.exec(path)
  if (shared) return { kind: 'shared', payload: shared[1] }
  if (path === '/sessions') return { kind: 'picker' }
  return { kind: 'current' }
}

export default function App() {
  const store = useMemo(() => new LocalSessionStore(), [])
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  const [importError, setImportError] = useState<string | undefined>()
  /** A link whose session the recipient already has, waiting on their answer. */
  const [conflict, setConflict] = useState<
    { incoming: VodSession; existing: VodSession } | undefined
  >()
  /**
   * The session this tab arrived at by opening a share link.
   *
   * Survives the hash swap that follows adoption, which is the point: by the
   * time the session renders, the URL says `#/session/<id>` and looks like any
   * other visit. Someone who opened a link came to watch, not to manage a
   * stream list, so that view starts with the sidebar out of the way.
   */
  const [arrivedFromShare, setArrivedFromShare] = useState<string | undefined>()

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((path: string) => {
    window.location.hash = path
  }, [])

  /**
   * Land on the most recent session, or make one.
   *
   * This is what removes the "create a review" step: there is always a working
   * surface to paste a report into, and a session exists because you used the
   * app, not because you named something first.
   */
  useEffect(() => {
    if (route.kind !== 'current') return
    let cancelled = false
    void (async () => {
      const existing = await store.listSessions()
      if (cancelled) return
      const id = existing[0]?.id ?? (await store.createSession()).id
      if (!cancelled) window.location.replace(`#/session/${id}`)
    })()
    return () => {
      cancelled = true
    }
  }, [route, store])

  /**
   * A shared link is saved locally, then the URL is replaced with the normal
   * route — otherwise a refresh would import it again.
   *
   * If the recipient already has the session the link points at, nothing is
   * written until they say which copy wins. Overwriting silently would throw
   * away notes they had written on their own copy, and there is no way to merge
   * two versions of a session that would not be a guess.
   */
  useEffect(() => {
    if (route.kind !== 'shared') return
    const decoded = decodeSession(route.payload)
    if (!decoded) {
      setImportError(
        'That share link could not be read. It may have been truncated when it ' +
          'was pasted — links past a few thousand characters get cut by some clients.',
      )
      return
    }
    let cancelled = false
    void (async () => {
      const existing = await store.getSession(decoded.id)
      if (cancelled) return
      if (existing) {
        setConflict({ incoming: decoded, existing })
        return
      }
      const saved = adoptSharedSession(decoded, 'update-in-place')
      await store.saveSession(saved)
      if (cancelled) return
      setArrivedFromShare(saved.id)
      window.location.replace(`#/session/${saved.id}`)
    })()
    return () => {
      cancelled = true
    }
  }, [route, store])

  const resolveConflict = useCallback(
    (adoption: ShareAdoption) => {
      if (!conflict) return
      const saved = adoptSharedSession(conflict.incoming, adoption)
      void store.saveSession(saved).then(() => {
        setConflict(undefined)
        setArrivedFromShare(saved.id)
        window.location.replace(`#/session/${saved.id}`)
      })
    },
    [conflict, store],
  )

  if (route.kind === 'shared') {
    return (
      <div className="pad">
        {importError ? (
          <>
            <p>{importError}</p>
            <button onClick={() => navigate('/')}>Start fresh</button>
          </>
        ) : conflict ? (
          <div className="share-conflict">
            <h2>You already have this session</h2>
            <p>
              “{conflict.existing.title}” is saved in this browser and was last changed{' '}
              {formatAge(conflict.existing.updatedAt)}. This link is another version of
              the same session.
            </p>
            <div className="share-conflict-actions">
              <button className="primary" onClick={() => resolveConflict('update-in-place')}>
                Replace my copy
              </button>
              <button onClick={() => resolveConflict('as-new-copy')}>Keep both</button>
            </div>
            <p className="dim">
              Replacing overwrites what you have, including any notes you wrote and
              broadcast delays you tuned. Keeping both saves the link alongside your
              copy and leaves yours untouched.
            </p>
          </div>
        ) : (
          <p>Opening shared session…</p>
        )}
      </div>
    )
  }

  if (route.kind === 'picker') {
    return <SessionPicker store={store} onOpen={(id) => navigate(`/session/${id}`)} />
  }

  if (route.kind === 'session') {
    return (
      <SessionView
        store={store}
        sessionId={route.id}
        fromShare={route.id === arrivedFromShare}
        onSwitchSession={() => navigate('/sessions')}
      />
    )
  }

  return <p className="pad">Loading…</p>
}
