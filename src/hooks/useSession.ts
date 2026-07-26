import { useCallback, useEffect, useRef, useState } from 'react'
import type { VodSession } from '../core/types'
import type { SessionStore } from '../core/storage'

/** Autosave debounce. Nudging a delay must not hammer IndexedDB. */
const SAVE_DEBOUNCE_MS = 500

/**
 * Loads one session and keeps it autosaved.
 *
 * `update` takes a producer so callers never read-modify-write against stale
 * state — several controls here fire in quick succession.
 */
export function useSession(
  store: SessionStore,
  sessionId: string | undefined,
): {
  session: VodSession | undefined
  loading: boolean
  update: (produce: (current: VodSession) => VodSession) => void
} {
  const [session, setSession] = useState<VodSession | undefined>()
  const [loading, setLoading] = useState(true)
  const saveTimer = useRef<number | undefined>(undefined)
  /** The edit a pending debounce will write, kept for the unmount flush. */
  const pendingSave = useRef<VodSession | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    if (!sessionId) {
      setSession(undefined)
      setLoading(false)
      return
    }
    setLoading(true)
    void store.getSession(sessionId).then((loaded) => {
      if (cancelled) return
      setSession(loaded)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [store, sessionId])

  const update = useCallback(
    (produce: (current: VodSession) => VodSession) => {
      setSession((current) => {
        if (!current) return current
        const next = produce(current)
        pendingSave.current = next
        if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => {
          pendingSave.current = undefined
          void store.saveSession(next)
        }, SAVE_DEBOUNCE_MS)
        return next
      })
    },
    [store],
  )

  // Flush a pending autosave on unmount. Cancelling the timer alone would lose
  // the last edit when navigating away mid-debounce.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current)
      const unsaved = pendingSave.current
      pendingSave.current = undefined
      if (unsaved) void store.saveSession(unsaved)
    }
  }, [store])

  return { session, loading, update }
}
