import { useCallback, useEffect, useMemo, useState } from 'react'
import { LocalReviewStore } from './core/localStore'
import { ReviewList } from './components/ReviewList'
import { ReviewView } from './components/ReviewView'
import { adoptSharedReview, decodeReview } from './core/share'
import './App.css'

/**
 * Hash-based routing.
 *
 * GitHub Pages has no rewrite rules, so a path-based deep link would 404 before
 * the app ever loaded. Everything after `#` is ours:
 *   #/                     review list
 *   #/review/<id>          one review
 *   #/shared/<payload>     a review encoded into the link itself
 */
type Route =
  | { kind: 'list' }
  | { kind: 'review'; id: string }
  | { kind: 'shared'; payload: string }

function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const reviewMatch = /^\/review\/(.+)$/.exec(path)
  if (reviewMatch) return { kind: 'review', id: reviewMatch[1] }
  const sharedMatch = /^\/shared\/(.+)$/.exec(path)
  if (sharedMatch) return { kind: 'shared', payload: sharedMatch[1] }
  return { kind: 'list' }
}

export default function App() {
  const store = useMemo(() => new LocalReviewStore(), [])
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((path: string) => {
    window.location.hash = path
  }, [])

  const [importError, setImportError] = useState<string | undefined>()

  // A shared link is saved locally as its own copy, then the URL is replaced
  // with the normal review route — otherwise a refresh would import it twice.
  useEffect(() => {
    if (route.kind !== 'shared') return
    const decoded = decodeReview(route.payload)
    if (!decoded) {
      setImportError(
        'That share link could not be read. It may have been truncated when it ' +
          'was pasted — links past a few thousand characters get cut by some chat clients.',
      )
      return
    }
    const copy = adoptSharedReview(decoded)
    void store.saveReview(copy).then(() => {
      window.location.replace(`#/review/${copy.id}`)
    })
  }, [route, store])

  if (route.kind === 'shared') {
    return (
      <div className="pad">
        {importError ? (
          <>
            <p>{importError}</p>
            <button onClick={() => navigate('/')}>Back to reviews</button>
          </>
        ) : (
          <p>Opening shared review…</p>
        )}
      </div>
    )
  }

  if (route.kind === 'review') {
    return (
      <ReviewView
        store={store}
        reviewId={route.id}
        onBack={() => navigate('/')}
      />
    )
  }

  return <ReviewList store={store} onOpen={(id) => navigate(`/review/${id}`)} />
}
