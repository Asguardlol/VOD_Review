import { useMemo, useState } from 'react'
import type { ReviewStore } from '../core/storage'
import type { VodPov, VodReview } from '../core/types'
import { useReview } from '../hooks/useReview'
import { useTimeline } from '../hooks/useTimeline'
import { newId } from '../core/ids'
import { buildShareUrl, exportReviewJson, URL_LENGTH_WARN_THRESHOLD, encodeReview } from '../core/share'
import { PovTile } from './PovTile'
import { TransportBar } from './TransportBar'
import { AddPovForm } from './AddPovForm'
import { MenuButton } from './MenuButton'

interface Props {
  store: ReviewStore
  reviewId: string
  onBack(): void
}

/** Guild filter value meaning "show everything". */
const ALL = '__all__'

export function ReviewView({ store, reviewId, onBack }: Props) {
  const { review, loading, update } = useReview(store, reviewId)
  const { engine, state } = useTimeline()
  const [activeGuild, setActiveGuild] = useState<string>(ALL)

  const visiblePovs = useMemo(() => {
    if (!review) return []
    if (activeGuild === ALL) return review.povs
    return review.povs.filter((p) => (p.vodGuildId ?? '') === activeGuild)
  }, [review, activeGuild])

  if (loading) return <p className="pad">Loading…</p>
  if (!review) {
    return (
      <div className="pad">
        <p>That review no longer exists.</p>
        <button onClick={onBack}>Back to reviews</button>
      </div>
    )
  }

  const mutate = (produce: (r: VodReview) => VodReview) => update(produce)

  const addPov = (pov: VodPov) => {
    mutate((r) => ({
      ...r,
      povs: [...r.povs, pov],
      // First POV added becomes the audible one, so there is always exactly one.
      audioPovId: r.audioPovId ?? pov.id,
    }))
    if (!review.audioPovId) engine.setAudioPov(pov.id)
  }

  const removePov = (povId: string) => {
    mutate((r) => {
      const povs = r.povs.filter((p) => p.id !== povId)
      const audioPovId = r.audioPovId === povId ? povs[0]?.id : r.audioPovId
      return { ...r, povs, audioPovId }
    })
  }

  const setAudio = (povId: string) => {
    mutate((r) => ({ ...r, audioPovId: povId }))
    engine.setAudioPov(povId)
  }

  /**
   * "Sync here": the POV is showing the moment the user cares about, so make
   * that moment line up with the current timeline position.
   */
  const syncHere = (povId: string) => {
    const offsetMs = engine.offsetForCurrentPosition(povId)
    if (offsetMs === undefined) return
    mutate((r) => ({
      ...r,
      povs: r.povs.map((p) => (p.id === povId ? { ...p, offsetMs } : p)),
    }))
  }

  const renamePov = (pov: VodPov) => {
    const next = window.prompt('Whose POV is this?', pov.label)
    if (next === null) return
    mutate((r) => ({
      ...r,
      povs: r.povs.map((p) => (p.id === pov.id ? { ...p, label: next.trim() } : p)),
    }))
  }

  const markUnavailable = (
    povId: string,
    reason: NonNullable<VodPov['unavailableReason']>,
  ) => {
    mutate((r) => ({
      ...r,
      povs: r.povs.map((p) => (p.id === povId ? { ...p, unavailableReason: reason } : p)),
    }))
  }

  const addGuild = () => {
    const name = window.prompt('Group name (guild, team, roster…)')
    if (!name?.trim()) return
    const guild = { id: newId(), name: name.trim() }
    mutate((r) => ({ ...r, guilds: [...r.guilds, guild] }))
    setActiveGuild(guild.id)
  }

  const addMarker = () => {
    const label = window.prompt('Label for this moment')
    if (!label?.trim()) return
    mutate((r) => ({
      ...r,
      markers: [
        ...r.markers,
        { id: newId(), atMs: Math.round(state.positionMs), label: label.trim() },
      ],
    }))
  }

  const share = () => {
    const { length } = encodeReview(review)
    if (length > URL_LENGTH_WARN_THRESHOLD) {
      const proceed = window.confirm(
        `This review makes a ${length}-character link, which some chat clients ` +
          `will truncate. Copy it anyway? (Cancel to download JSON instead.)`,
      )
      if (!proceed) {
        downloadJson()
        return
      }
    }
    void navigator.clipboard.writeText(buildShareUrl(review))
  }

  const downloadJson = () => {
    const blob = new Blob([exportReviewJson(review)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${review.title.replace(/[^\w-]+/g, '_') || 'review'}.review.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="review-view">
      <header className="review-header">
        <button className="back" onClick={onBack}>
          ‹ Reviews
        </button>
        <h1>{review.title}</h1>
        <button onClick={share} title="Copy a shareable link">
          Share
        </button>
        <MenuButton
          actions={[
            { label: 'Rename review…', onSelect: () => {
              const next = window.prompt('Review title', review.title)
              if (next?.trim()) mutate((r) => ({ ...r, title: next.trim() }))
            } },
            { label: 'Add group…', onSelect: addGuild },
            { label: 'Download JSON', onSelect: downloadJson },
            {
              label: 'Delete review',
              destructive: true,
              confirm: `Delete "${review.title}" and all ${review.povs.length} POVs? This cannot be undone.`,
              onSelect: () => {
                void store.deleteReview(review.id).then(onBack)
              },
            },
          ]}
        />
      </header>

      <TransportBar
        engine={engine}
        state={state}
        markers={review.markers}
        durationMs={engine.durationMs()}
        onAddMarker={addMarker}
        onSeekMarker={(m) => engine.seekTo(m.atMs)}
      />

      {review.guilds.length > 0 && (
        <nav className="guild-tabs">
          <button
            className={activeGuild === ALL ? 'active' : undefined}
            onClick={() => setActiveGuild(ALL)}
          >
            All ({review.povs.length})
          </button>
          {review.guilds.map((guild) => {
            const count = review.povs.filter((p) => p.vodGuildId === guild.id).length
            return (
              <button
                key={guild.id}
                className={activeGuild === guild.id ? 'active' : undefined}
                onClick={() => setActiveGuild(guild.id)}
              >
                {guild.name} ({count})
              </button>
            )
          })}
          <button
            className={activeGuild === '' ? 'active' : undefined}
            onClick={() => setActiveGuild('')}
          >
            Ungrouped ({review.povs.filter((p) => !p.vodGuildId).length})
          </button>
        </nav>
      )}

      <AddPovForm
        guilds={review.guilds}
        defaultGuildId={activeGuild === ALL ? undefined : activeGuild}
        onAdd={addPov}
      />

      {review.povs.length === 0 ? (
        <p className="empty">
          No POVs yet. Paste a YouTube or Twitch VOD link above to add the first one.
        </p>
      ) : (
        <div className="pov-grid">
          {visiblePovs.map((pov) => (
            <PovTile
              key={pov.id}
              pov={pov}
              engine={engine}
              isAudio={review.audioPovId === pov.id}
              isStalled={state.stalledPovIds.includes(pov.id)}
              onMakeAudio={() => setAudio(pov.id)}
              onSyncHere={() => syncHere(pov.id)}
              onRename={() => renamePov(pov)}
              onRemove={() => removePov(pov.id)}
              onUnavailable={(reason) => markUnavailable(pov.id, reason)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
