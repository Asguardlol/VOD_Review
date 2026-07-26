import { useCallback, useEffect, useRef, useState } from 'react'
import type { VodReview } from '../core/types'
import type { ReviewStore } from '../core/storage'

/** Autosave debounce. Dragging a sync handle must not hammer IndexedDB. */
const SAVE_DEBOUNCE_MS = 500

/**
 * Loads one review and keeps it autosaved.
 *
 * `update` takes a producer so callers never have to read-modify-write against
 * stale state — several controls here fire in quick succession.
 */
export function useReview(
  store: ReviewStore,
  reviewId: string | undefined,
): {
  review: VodReview | undefined
  loading: boolean
  update: (produce: (current: VodReview) => VodReview) => void
} {
  const [review, setReview] = useState<VodReview | undefined>()
  const [loading, setLoading] = useState(true)
  const saveTimer = useRef<number | undefined>(undefined)
  /** The edit a pending debounce is going to write, kept for unmount flush. */
  const pendingSave = useRef<VodReview | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    if (!reviewId) {
      setReview(undefined)
      setLoading(false)
      return
    }
    setLoading(true)
    void store.getReview(reviewId).then((loaded) => {
      if (cancelled) return
      setReview(loaded)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [store, reviewId])

  const update = useCallback(
    (produce: (current: VodReview) => VodReview) => {
      setReview((current) => {
        if (!current) return current
        const next = produce(current)
        pendingSave.current = next
        if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => {
          pendingSave.current = undefined
          void store.saveReview(next)
        }, SAVE_DEBOUNCE_MS)
        return next
      })
    },
    [store],
  )

  // Flush a pending autosave on unmount, so navigating away mid-debounce does
  // not silently drop the last edit. Cancelling the timer alone would lose it.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current)
      const unsaved = pendingSave.current
      pendingSave.current = undefined
      if (unsaved) void store.saveReview(unsaved)
    }
  }, [store])

  return { review, loading, update }
}
