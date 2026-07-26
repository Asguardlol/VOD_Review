import { useEffect, useMemo, useState } from 'react'
import type { ReviewStore } from '../core/storage'
import type { VodGuild, VodPov, VodReview } from '../core/types'
import { useReview } from '../hooks/useReview'
import { useTimeline } from '../hooks/useTimeline'
import { newId } from '../core/ids'
import {
  buildShareUrl,
  encodeReview,
  exportReviewJson,
  URL_LENGTH_WARN_THRESHOLD,
} from '../core/share'
import { PovTile } from './PovTile'
import { TransportBar } from './TransportBar'
import { AddPovForm } from './AddPovForm'
import { MenuButton } from './MenuButton'
import { PovSidebar } from './PovSidebar'
import { AttachLogPanel } from './AttachLogPanel'
import { createWclClient } from '../wcl/config'

interface Props {
  store: ReviewStore
  reviewId: string
  onBack(): void
}

/**
 * How many POVs can play at once.
 *
 * Four is a deliberate ceiling, not a technical one: past four the tiles are too
 * small to read anything useful off, and four simultaneous video streams is
 * already a lot to ask of a connection. The sidebar is how a review holds far
 * more than four and stays browsable.
 */
const MAX_WATCHING = 4

export function ReviewView({ store, reviewId, onBack }: Props) {
  const { review, loading, update } = useReview(store, reviewId)
  const { engine, state } = useTimeline()
  // Undefined when Warcraft Logs is not configured. Everything else still works.
  const wclClient = useMemo(() => createWclClient(), [])

  /**
   * Which POVs are on screen. View state, deliberately not persisted — it is
   * about what you're looking at right now, not a property of the review.
   */
  const [watching, setWatching] = useState<string[]>([])

  // One stream is the default: the first POV starts watched, and a review that
  // ends up with nothing selected falls back rather than showing a blank grid.
  useEffect(() => {
    if (!review) return
    setWatching((current) => {
      const stillValid = current.filter((id) => review.povs.some((p) => p.id === id))
      if (stillValid.length > 0) return stillValid
      const first = review.povs[0]?.id
      return first ? [first] : []
    })
  }, [review])

  const watchedPovs = useMemo(
    () =>
      watching
        .map((id) => review?.povs.find((p) => p.id === id))
        .filter((p): p is VodPov => p !== undefined),
    [watching, review],
  )

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
      audioPovId: r.audioPovId ?? pov.id,
    }))
    if (!review.audioPovId) engine.setAudioPov(pov.id)
    // A newly added POV is almost always the one you want to look at, but not
    // at the cost of evicting something already on screen.
    setWatching((current) =>
      current.length < MAX_WATCHING ? [...current, pov.id] : current,
    )
  }

  const removePov = (povId: string) => {
    mutate((r) => {
      const povs = r.povs.filter((p) => p.id !== povId)
      const audioPovId = r.audioPovId === povId ? povs[0]?.id : r.audioPovId
      return { ...r, povs, audioPovId }
    })
    setWatching((current) => current.filter((id) => id !== povId))
  }

  const toggleWatch = (povId: string) => {
    setWatching((current) => {
      if (current.includes(povId)) return current.filter((id) => id !== povId)
      if (current.length >= MAX_WATCHING) return current
      return [...current, povId]
    })
  }

  const soloWatch = (povId: string) => setWatching([povId])

  const setAudio = (povId: string) => {
    mutate((r) => ({ ...r, audioPovId: povId }))
    engine.setAudioPov(povId)
    // Audio only reaches you from a POV that is actually mounted, so listening
    // to something implies watching it.
    setWatching((current) =>
      current.includes(povId)
        ? current
        : current.length >= MAX_WATCHING
          ? [...current.slice(0, MAX_WATCHING - 1), povId]
          : [...current, povId],
    )
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

  const movePov = (povId: string, guildId: string | undefined) => {
    mutate((r) => ({
      ...r,
      povs: r.povs.map((p) => (p.id === povId ? { ...p, vodGuildId: guildId } : p)),
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
    mutate((r) => ({ ...r, guilds: [...r.guilds, { id: newId(), name: name.trim() }] }))
  }

  const renameGuild = (guild: VodGuild) => {
    const next = window.prompt('Group name', guild.name)
    if (!next?.trim()) return
    mutate((r) => ({
      ...r,
      guilds: r.guilds.map((g) => (g.id === guild.id ? { ...g, name: next.trim() } : g)),
    }))
  }

  const removeGuild = (guildId: string) => {
    mutate((r) => ({
      ...r,
      guilds: r.guilds.filter((g) => g.id !== guildId),
      // Orphaned POVs become ungrouped. Deleting a group is an organizational
      // action; it must never destroy footage.
      povs: r.povs.map((p) =>
        p.vodGuildId === guildId ? { ...p, vodGuildId: undefined } : p,
      ),
    }))
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

  const downloadJson = () => {
    const blob = new Blob([exportReviewJson(review)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${review.title.replace(/[^\w-]+/g, '_') || 'review'}.review.json`
    anchor.click()
    URL.revokeObjectURL(url)
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
            {
              label: 'Rename review…',
              onSelect: () => {
                const next = window.prompt('Review title', review.title)
                if (next?.trim()) mutate((r) => ({ ...r, title: next.trim() }))
              },
            },
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
        deaths={review.deaths}
        // A log bounds the timeline by the pull. Without one there is nothing
        // authoritative to bound it by, so it falls back to the longest VOD.
        durationMs={review.fight?.durationMs ?? engine.durationMs()}
        boundedByFight={review.fight !== undefined}
        onAddMarker={addMarker}
        onSeekMarker={(m) => engine.seekTo(m.atMs)}
      />

      <div className="review-body">
        <PovSidebar
          guilds={review.guilds}
          povs={review.povs}
          watching={watching}
          maxWatching={MAX_WATCHING}
          audioPovId={review.audioPovId}
          onToggleWatch={toggleWatch}
          onSoloWatch={soloWatch}
          onMakeAudio={setAudio}
          onRenamePov={renamePov}
          onRemovePov={removePov}
          onMovePov={movePov}
          onAddGuild={addGuild}
          onRenameGuild={renameGuild}
          onRemoveGuild={removeGuild}
        />

        <main className="review-main">
          <AttachLogPanel
            client={wclClient}
            fight={review.fight}
            onAttach={(fight, deaths) => mutate((r) => ({ ...r, fight, deaths }))}
            onDetach={() =>
              mutate((r) => ({ ...r, fight: undefined, deaths: [] }))
            }
          />

          <AddPovForm guilds={review.guilds} onAdd={addPov} />

          {review.povs.length === 0 ? (
            <p className="empty">
              No POVs yet. Paste a YouTube or Twitch VOD link above to add the first one.
            </p>
          ) : watchedPovs.length === 0 ? (
            <p className="empty">Pick a POV from the list to start watching.</p>
          ) : (
            <div className="pov-grid" data-count={watchedPovs.length}>
              {watchedPovs.map((pov) => (
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
        </main>
      </div>
    </div>
  )
}
