import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionStore } from '../core/storage'
import type { VodFight, VodGuild, VodStream } from '../core/types'
import { useSession } from '../hooks/useSession'
import { useTimeline } from '../hooks/useTimeline'
import { newId } from '../core/ids'
import { timelineOffsetMs, vodForStream, coversPull } from '../core/sync'
import {
  buildShareUrl,
  encodeSession,
  exportSessionJson,
  importSessionJson,
  URL_LENGTH_WARN_THRESHOLD,
} from '../core/share'
import { confidentReportCode, createWclClient, parseReportCode } from '../wcl/config'
import { parseChannelLogin } from '../twitch/helix'
import { TwitchAuthError } from '../twitch/client'
import { createTwitchClient } from '../twitch/config'
import {
  beginTwitchLogin,
  getStoredToken,
  isTwitchConfigured,
  clearTwitchToken,
} from '../twitch/auth'
import { StreamSidebar, type StreamDraft } from './StreamSidebar'
import { PullBrowser } from './PullBrowser'
import { StreamTile } from './StreamTile'
import { TransportBar } from './TransportBar'
import { MenuButton } from './MenuButton'
import { WclConnectPanel } from './WclConnectPanel'

interface Props {
  store: SessionStore
  sessionId: string
  onSwitchSession(): void
}

/**
 * Four is a deliberate ceiling, not a technical one: past four the tiles are too
 * small to read anything off, and four simultaneous streams is already a lot to
 * ask of a connection. The sidebar is how a session holds a whole raid's worth
 * and stays browsable.
 */
const MAX_WATCHING = 4

export function SessionView({ store, sessionId, onSwitchSession }: Props) {
  const { session, loading, update } = useSession(store, sessionId)
  const { engine, state } = useTimeline()
  const wclClient = useMemo(() => createWclClient(), [])
  const twitchClient = useMemo(() => createTwitchClient(), [])

  const [watching, setWatching] = useState<string[]>([])
  /**
   * The guild in scope, if any. View state like `watching` — it is about what
   * you are looking at now, not a property of the night.
   */
  const [activeGuildId, setActiveGuildId] = useState<string | undefined>()
  const [reportInput, setReportInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [twitchConnected, setTwitchConnected] = useState(() => !!getStoredToken())
  /**
   * Last code auto-loaded, so re-editing the same text doesn't refire.
   * A ref rather than state: it must update synchronously within the same
   * change handler that reads it, or a fast paste fires twice.
   */
  const lastLoadedRef = useRef<string | undefined>(undefined)

  const selectedFight = useMemo(
    () => session?.report?.fights.find((f) => f.fightId === session.selectedFightId),
    [session],
  )

  // The engine has no memory across a page load, so a reopened session has to
  // tell it which stream is audible — otherwise everything stays muted and the
  // reference clock is whichever registered first.
  useEffect(() => {
    if (session?.audioStreamId) engine.setAudioPov(session.audioStreamId)
  }, [engine, session?.audioStreamId])

  // Default to one stream, and never leave a dead id selected.
  useEffect(() => {
    if (!session) return
    setWatching((current) => {
      const valid = current.filter((id) =>
        session.streams.some((s) => s.id === id && (s.resolved || s.source.kind === 'video')),
      )
      if (valid.length > 0) return valid
      const first = session.streams.find((s) => s.resolved || s.source.kind === 'video')
      return first ? [first.id] : []
    })
  }, [session])

  /**
   * With exactly one stream on screen, it is the one you are listening to.
   *
   * Otherwise soloing a stream that happened not to be the audio stream played
   * silence: the audible one was no longer mounted, nothing could be heard, and
   * with the per-tile control hidden there was no visible way to fix it.
   */
  useEffect(() => {
    if (watching.length !== 1 || !session) return
    const only = watching[0]
    if (session.audioStreamId === only) return
    update((s) => ({ ...s, audioStreamId: only }))
    engine.setAudioPov(only)
  }, [watching, session, update, engine])

  /**
   * Finds each stream's VOD for the report's time range.
   *
   * Runs per stream and records failures on the stream rather than aborting:
   * one raider who didn't stream must not stop the other nineteen resolving.
   */
  const resolveStreams = useCallback(
    async (streams: VodStream[], rangeStart: number, rangeEnd: number) => {
      if (!twitchClient) return streams
      const results = await Promise.all(
        streams.map(async (stream) => {
          if (stream.source.kind !== 'twitch-channel') return stream
          try {
            const found = await twitchClient.resolveChannelVod(
              stream.source.login,
              rangeStart,
              rangeEnd,
            )
            return found.ok
              ? { ...stream, resolved: found.vod, unavailableReason: undefined }
              : { ...stream, resolved: undefined, unavailableReason: found.reason }
          } catch (caught) {
            if (caught instanceof TwitchAuthError) throw caught
            return { ...stream, resolved: undefined, unavailableReason: 'not-found' as const }
          }
        }),
      )
      return results
    },
    [twitchClient],
  )

  /**
   * Re-resolve streams when the pieces needed to do so arrive late.
   *
   * Resolution needs both a report (for its time range) and a Twitch
   * connection, and they can arrive in either order — connecting Twitch after
   * loading a report, or adding streams before connecting. Without this those
   * streams stay greyed with disabled checkboxes, and the only way to recover
   * is reloading the report, which nobody would guess.
   *
   * Keyed on the report plus the pending stream ids so a lookup that
   * legitimately finds nothing — someone who genuinely did not stream — settles
   * instead of retrying forever.
   */
  const resolveKeyRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const report = session?.report
    if (!report || !twitchConnected || !twitchClient) return

    const pending = session.streams.filter(
      (s) => s.source.kind === 'twitch-channel' && !s.resolved && !s.unavailableReason,
    )
    if (pending.length === 0) return

    const key = `${report.code}:${pending.map((s) => s.id).join(',')}`
    if (resolveKeyRef.current === key) return
    resolveKeyRef.current = key

    void (async () => {
      try {
        const resolved = await resolveStreams(pending, report.startTime, report.endTime)
        const byId = new Map(resolved.map((s) => [s.id, s]))
        update((s) => ({ ...s, streams: s.streams.map((x) => byId.get(x.id) ?? x) }))
      } catch (caught) {
        if (caught instanceof TwitchAuthError) {
          setTwitchConnected(false)
          setError(caught.message)
        }
      }
    })()
  }, [session, twitchConnected, twitchClient, resolveStreams, update])

  if (loading) return <p className="pad">Loading…</p>
  if (!session) {
    return (
      <div className="pad">
        <p>That session no longer exists.</p>
        <button onClick={onSwitchSession}>Back</button>
      </div>
    )
  }

  const loadReport = async (raw: string) => {
    if (!wclClient) return
    const code = parseReportCode(raw)
    if (!code) {
      setError('That does not look like a Warcraft Logs report link or code.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const report = await wclClient.listFights(code)
      let streams = session.streams
      if (twitchConnected && streams.length > 0) {
        try {
          streams = await resolveStreams(streams, report.startTime, report.endTime)
        } catch (caught) {
          if (caught instanceof TwitchAuthError) {
            setTwitchConnected(false)
            setError(caught.message)
          }
        }
      }
      update((s) => ({
        ...s,
        title: s.title === 'Untitled night' ? report.title : s.title,
        report: {
          code: report.code,
          title: report.title,
          startTime: report.startTime,
          endTime: report.endTime,
          fights: report.fights,
          fetchedAt: Date.now(),
        },
        streams,
        // A stale pull id from a previous report would silently point at the
        // wrong fight: fight ids are only unique within a report.
        selectedFightId: undefined,
        deaths: [],
        events: [],
      }))
      setReportInput('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load that report.')
    } finally {
      setBusy(false)
    }
  }

  const selectFight = async (fight: VodFight) => {
    update((s) => ({ ...s, selectedFightId: fight.fightId, deaths: [], markers: [] }))
    engine.seekTo(0)
    if (!wclClient) return
    try {
      const deaths = await wclClient.listDeaths(fight)
      update((s) => (s.selectedFightId === fight.fightId ? { ...s, deaths } : s))
    } catch {
      // Deaths are an overlay, not the point. A pull that loads without them is
      // still fully reviewable, so this degrades silently rather than blocking.
    }
  }

  const addStream = async (draft: StreamDraft) => {
    const login = parseChannelLogin(draft.channel)
    if (!login) {
      setError('That does not look like a Twitch channel name or URL.')
      return
    }
    const stream: VodStream = {
      id: newId(),
      source: { kind: 'twitch-channel', login },
      label: draft.label,
      role: draft.role,
      wowClass: draft.wowClass,
      offsetMs: draft.offsetMs,
    }
    update((s) => ({
      ...s,
      streams: [...s.streams, stream],
      audioStreamId: s.audioStreamId ?? stream.id,
    }))
    if (!session.audioStreamId) engine.setAudioPov(stream.id)

    const report = session.report
    if (report && twitchConnected) {
      try {
        const [resolved] = await resolveStreams([stream], report.startTime, report.endTime)
        update((s) => ({
          ...s,
          streams: s.streams.map((x) => (x.id === stream.id ? resolved : x)),
        }))
      } catch (caught) {
        if (caught instanceof TwitchAuthError) {
          setTwitchConnected(false)
          setError(caught.message)
        }
      }
    }
    setWatching((current) =>
      current.length < MAX_WATCHING ? [...current, stream.id] : current,
    )
  }

  const editStream = (stream: VodStream, draft: StreamDraft) => {
    const login = parseChannelLogin(draft.channel) ?? stream.label
    update((s) => ({
      ...s,
      streams: s.streams.map((x) =>
        x.id === stream.id
          ? {
              ...x,
              source: { kind: 'twitch-channel', login },
              label: draft.label,
              role: draft.role,
              wowClass: draft.wowClass,
              offsetMs: draft.offsetMs,
            }
          : x,
      ),
    }))
  }

  /**
   * Selecting a guild scopes what can be watched to its members, so anyone
   * already on screen from outside it has to come off — otherwise the rule the
   * checkboxes enforce would be contradicted by what is actually playing.
   */
  const selectGuild = (guildId: string | undefined) => {
    setActiveGuildId(guildId)
    if (!guildId) return
    setWatching((current) =>
      current.filter((id) => session.streams.find((s) => s.id === id)?.guildId === guildId),
    )
  }

  const duplicateStream = (stream: VodStream) => {
    // The copy lands ungrouped so it can be dragged wherever it is wanted, and
    // keeps its resolved VOD so it does not need looking up again.
    const copy: VodStream = { ...stream, id: newId(), guildId: undefined }
    update((s) => ({ ...s, streams: [...s.streams, copy] }))
  }

  const moveToGuild = (streamId: string, guildId: string | undefined) => {
    update((s) => ({
      ...s,
      streams: s.streams.map((x) => (x.id === streamId ? { ...x, guildId } : x)),
    }))
    // Dragging someone out of the guild in scope also takes them off screen.
    if (activeGuildId !== undefined && guildId !== activeGuildId) {
      setWatching((current) => current.filter((id) => id !== streamId))
    }
  }

  const addGuild = () => {
    const name = window.prompt('Guild or team name')
    if (!name?.trim()) return
    update((s) => ({ ...s, guilds: [...s.guilds, { id: newId(), name: name.trim() }] }))
  }

  const renameGuild = (guild: VodGuild) => {
    const next = window.prompt('Guild name', guild.name)
    if (!next?.trim()) return
    update((s) => ({
      ...s,
      guilds: s.guilds.map((g) => (g.id === guild.id ? { ...g, name: next.trim() } : g)),
    }))
  }

  const removeGuild = (guildId: string) => {
    update((s) => ({
      ...s,
      guilds: s.guilds.filter((g) => g.id !== guildId),
      // Orphaned members become ungrouped. Deleting a guild is organisational;
      // it must never destroy footage.
      streams: s.streams.map((x) => (x.guildId === guildId ? { ...x, guildId: undefined } : x)),
    }))
    if (activeGuildId === guildId) setActiveGuildId(undefined)
  }

  const removeStream = (streamId: string) => {
    update((s) => {
      const streams = s.streams.filter((x) => x.id !== streamId)
      return {
        ...s,
        streams,
        audioStreamId: s.audioStreamId === streamId ? streams[0]?.id : s.audioStreamId,
      }
    })
    setWatching((current) => current.filter((id) => id !== streamId))
  }

  const nudgeDelay = (streamId: string, deltaMs: number) => {
    update((s) => ({
      ...s,
      streams: s.streams.map((x) =>
        x.id === streamId ? { ...x, offsetMs: x.offsetMs + deltaMs } : x,
      ),
    }))
  }

  const setAudio = (streamId: string) => {
    update((s) => ({ ...s, audioStreamId: streamId }))
    engine.setAudioPov(streamId)
    setWatching((current) =>
      current.includes(streamId)
        ? current
        : current.length >= MAX_WATCHING
          ? [...current.slice(0, MAX_WATCHING - 1), streamId]
          : [...current, streamId],
    )
  }

  const downloadJson = () => {
    const blob = new Blob([exportSessionJson(session)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${session.title.replace(/[^\w-]+/g, '_') || 'session'}.vod.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const share = () => {
    const { length } = encodeSession(session)
    if (length > URL_LENGTH_WARN_THRESHOLD) {
      if (
        !window.confirm(
          `This session makes a ${length}-character link, which some chat ` +
            `clients will truncate. Copy it anyway? (Cancel to download JSON.)`,
        )
      ) {
        downloadJson()
        return
      }
    }
    void navigator.clipboard.writeText(buildShareUrl(session))
  }

  const watched = watching
    .map((id) => session.streams.find((s) => s.id === id))
    .filter((s): s is VodStream => s !== undefined)

  return (
    <div className="review-view">
      <header className="review-header">
        <h1>{session.title}</h1>
        {isTwitchConfigured() &&
          (twitchConnected ? (
            <MenuButton
              label="Twitch ✓"
              title="Twitch connection"
              actions={[
                {
                  label: 'Disconnect Twitch',
                  onSelect: () => {
                    clearTwitchToken()
                    setTwitchConnected(false)
                  },
                },
              ]}
            />
          ) : (
            <button onClick={beginTwitchLogin} title="Needed to find VODs by channel name">
              Connect Twitch
            </button>
          ))}
        <button onClick={share}>Share</button>
        <MenuButton
          actions={[
            {
              label: 'Rename session…',
              onSelect: () => {
                const next = window.prompt('Session name', session.title)
                if (next?.trim()) update((s) => ({ ...s, title: next.trim() }))
              },
            },
            { label: 'Switch session…', onSelect: onSwitchSession },
            { label: 'Download JSON', onSelect: downloadJson },
          ]}
        />
      </header>

      <div className="review-body">
        {/*
          The sidebar is a column with one growing section: the stream list and
          connection panels keep their natural height, and the pull browser
          takes the rest and scrolls on its own. A raid night is dozens of
          pulls, so it has to scroll without dragging the whole page with it.
        */}
        <aside className="pov-sidebar">
          <StreamSidebar
            streams={session.streams}
            guilds={session.guilds}
            watching={watching}
            maxWatching={MAX_WATCHING}
            audioStreamId={session.audioStreamId}
            activeGuildId={activeGuildId}
            hasReport={!!session.report}
            onToggleWatch={(id) =>
              setWatching((current) =>
                current.includes(id)
                  ? current.filter((x) => x !== id)
                  : current.length >= MAX_WATCHING
                    ? current
                    : [...current, id],
              )
            }
            onSoloWatch={(id) => setWatching([id])}
            onMakeAudio={setAudio}
            onSelectGuild={selectGuild}
            onDuplicate={duplicateStream}
            onMoveToGuild={moveToGuild}
            onAddGuild={addGuild}
            onRenameGuild={renameGuild}
            onRemoveGuild={removeGuild}
            onAdd={(draft) => void addStream(draft)}
            onEdit={editStream}
            onRemove={removeStream}
            onExport={downloadJson}
            onImport={(file) => {
              void file.text().then((text) => {
                const imported = importSessionJson(text)
                if (!imported) {
                  setError('That file is not a session export this version understands.')
                  return
                }
                update((s) => ({ ...s, streams: imported.streams }))
              })
            }}
          />

          {!twitchConnected && isTwitchConfigured() && session.streams.length > 0 && (
            <p className="sidebar-empty dim">
              Connect Twitch to find each channel's VOD for this report.
            </p>
          )}
          {!isTwitchConfigured() && (
            <p className="sidebar-empty dim">
              No Twitch Client ID in this build, so channels can't be looked up.
              Set <code>VITE_TWITCH_CLIENT_ID</code>.
            </p>
          )}

          <WclConnectPanel />

          {session.report ? (
            <PullBrowser
              report={session.report}
              selectedFightId={session.selectedFightId}
              busy={busy}
              onSelect={(fight) => void selectFight(fight)}
              onRefresh={() => void loadReport(session.report!.code)}
              onRemove={() =>
                update((s) => ({
                  ...s,
                  report: undefined,
                  selectedFightId: undefined,
                  deaths: [],
                }))
              }
            />
          ) : (
            <form
              className="report-form"
              onSubmit={(e) => {
                e.preventDefault()
                void loadReport(reportInput)
              }}
            >
              <label className="dim">Paste URL for public or unlisted logs</label>
              <input
                value={reportInput}
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.value
                  setReportInput(value)
                  // Load as soon as the input is unmistakably a report, so the
                  // common case — pasting a link — needs no second action.
                  // Covers paste, drag-drop and autofill alike, since all of
                  // them land here, unlike a paste-only handler.
                  const code = confidentReportCode(value)
                  if (code && code !== lastLoadedRef.current) {
                    lastLoadedRef.current = code
                    void loadReport(value)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  // Enter loads whatever is there, using the lenient parse. It
                  // is the escape hatch for what auto-detect declines to fire
                  // on by itself: hand-typed codes, and WCL's older short ones.
                  e.preventDefault()
                  lastLoadedRef.current = confidentReportCode(reportInput)
                  void loadReport(reportInput)
                }}
                placeholder="WarcraftLogs Report URL"
                aria-label="Report URL"
              />
              {busy && <span className="dim">Loading report…</span>}
            </form>
          )}

          {error && <p className="form-error">{error}</p>}
        </aside>

        <main className="review-main">
          {!session.report ? (
            <p className="empty">
              Paste a Warcraft Logs report to see the night's pulls, and add the
              people who streamed it.
            </p>
          ) : !selectedFight ? (
            <p className="empty">Pick a pull from the list to load it.</p>
          ) : watched.length === 0 ? (
            <p className="empty">
              No stream selected. Tick someone in the list — greyed-out names had
              no VOD covering this report.
            </p>
          ) : (
            <div className="pov-grid" data-count={watched.length}>
              {watched.map((stream) => {
                const vod = vodForStream(stream)
                const offset = timelineOffsetMs(stream, selectedFight)
                if (!vod || offset === undefined) return null
                if (!coversPull(stream, selectedFight)) {
                  return (
                    <div key={stream.id} className="pov-tile">
                      <div className="pov-header">
                        <span className="pov-label">{stream.label}</span>
                      </div>
                      <div className="pov-video">
                        <div className="pov-overlay pov-error">
                          <strong>Not in this VOD</strong>
                          <p>
                            {stream.label}'s recording doesn't cover this pull —
                            they started late or stopped early.
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                }
                return (
                  <StreamTile
                    key={stream.id}
                    stream={stream}
                    vod={vod}
                    timelineOffsetMs={offset}
                    engine={engine}
                    isAudio={session.audioStreamId === stream.id}
                    canChooseAudio={watched.length > 1}
                    isStalled={state.stalledPovIds.includes(stream.id)}
                    onMakeAudio={() => setAudio(stream.id)}
                    onNudgeDelay={(delta) => nudgeDelay(stream.id, delta)}
                    onEdit={() => {}}
                    onRemove={() => removeStream(stream.id)}
                    onUnavailable={(reason) =>
                      update((s) => ({
                        ...s,
                        streams: s.streams.map((x) =>
                          x.id === stream.id ? { ...x, unavailableReason: reason } : x,
                        ),
                      }))
                    }
                  />
                )
              })}
            </div>
          )}

          {/*
            Transport sits under the video, the way every video tool puts it —
            it is a control for the thing above it, and having it above pushed
            the players down the page for no reason.
          */}
          {selectedFight && (
            <TransportBar
              engine={engine}
              state={state}
              markers={session.markers}
              deaths={session.deaths}
              durationMs={selectedFight.durationMs}
              boundedByFight
              onAddMarker={() => {
                const label = window.prompt('Label for this moment')
                if (!label?.trim()) return
                update((s) => ({
                  ...s,
                  markers: [
                    ...s.markers,
                    { id: newId(), atMs: Math.round(state.positionMs), label: label.trim() },
                  ],
                }))
              }}
              onSeekMarker={(m) => engine.seekTo(m.atMs)}
            />
          )}
        </main>
      </div>
    </div>
  )
}
