import { useCallback, useEffect, useState } from 'react'
import type { ReviewStore, ReviewSummary } from '../core/storage'
import { importReviewJson } from '../core/share'
import { MenuButton } from './MenuButton'

interface Props {
  store: ReviewStore
  onOpen(id: string): void
}

export function ReviewList({ store, onOpen }: Props) {
  const [reviews, setReviews] = useState<ReviewSummary[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setReviews(await store.listReviews())
    setLoading(false)
  }, [store])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = async () => {
    const title = window.prompt('Review title', 'Untitled pull')
    if (!title?.trim()) return
    const review = await store.createReview(title.trim())
    onOpen(review.id)
  }

  const importJson = async (file: File) => {
    const review = importReviewJson(await file.text())
    if (!review) {
      window.alert('That file is not a review export this version understands.')
      return
    }
    await store.saveReview(review)
    await refresh()
  }

  return (
    <div className="review-list">
      <header className="review-header">
        <h1>VOD Review</h1>
        <button onClick={() => void create()}>New review</button>
        <label className="import-button">
          Import JSON
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importJson(file)
              e.target.value = ''
            }}
          />
        </label>
      </header>

      {loading ? (
        <p className="pad">Loading…</p>
      ) : reviews.length === 0 ? (
        <div className="empty">
          <p>No reviews yet.</p>
          <p className="dim">
            A review holds several players' recordings of the same pull, synced to
            one timeline.
          </p>
        </div>
      ) : (
        <ul className="review-items">
          {reviews.map((review) => (
            <li key={review.id}>
              <button className="review-open" onClick={() => onOpen(review.id)}>
                <span className="review-title">{review.title}</span>
                <span className="dim">
                  {review.povCount} POV{review.povCount === 1 ? '' : 's'} ·{' '}
                  {new Date(review.updatedAt).toLocaleDateString()}
                </span>
              </button>
              <MenuButton
                actions={[
                  {
                    label: 'Delete review',
                    destructive: true,
                    confirm: `Delete "${review.title}"? This cannot be undone.`,
                    onSelect: () => {
                      void store.deleteReview(review.id).then(refresh)
                    },
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      <footer className="storage-note">
        Reviews are stored in this browser only — there is no server. Use Share or
        Download JSON to move one somewhere else.
      </footer>
    </div>
  )
}
