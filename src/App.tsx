import { useCallback, useEffect, useMemo, useState } from 'react'
import { LocalSessionStore } from './core/localStore'
import { SessionView } from './components/SessionView'
import { SessionPicker } from './components/SessionPicker'
import { adoptSharedSession, decodeSession } from './core/share'
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

  // A shared link is saved locally as its own copy, then the URL is replaced
  // with the normal route — otherwise a refresh would import it twice.
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
    const copy = adoptSharedSession(decoded)
    void store.saveSession(copy).then(() => {
      window.location.replace(`#/session/${copy.id}`)
    })
  }, [route, store])

  if (route.kind === 'shared') {
    return (
      <div className="pad">
        {importError ? (
          <>
            <p>{importError}</p>
            <button onClick={() => navigate('/')}>Start fresh</button>
          </>
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
        onSwitchSession={() => navigate('/sessions')}
      />
    )
  }

  return <p className="pad">Loading…</p>
}
