import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionStore } from '../core/storage'
import type { VodFight, VodGuild, VodStream } from '../core/types'
import { useSession } from '../hooks/useSession'
import { useTimeline } from '../hooks/useTimeline'
import { newId } from '../core/ids'
import { timelineOffsetMs, vodForStream, coversPull } from '../core/sync'
import {
  buildShareUrl,
  exportRosterJson,
  exportSessionJson,
  importRosterJson,
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
import { NotesPanel } from './NotesPanel'
import { ShareDialog } from './ShareDialog'
import { PasteDialog } from './PasteDialog'
import { WclConnectPanel } from './WclConnectPanel'

interface Props {
  store: SessionStore
  sessionId: string
  /** True when this tab got here by opening a share link. */
  fromShare?: boolean
  onSwitchSession(): void
}

/**
 * Four is a deliberate ceiling, not a technical one: past four the tiles are too
 * small to read anything off, and four simultaneous streams is already a lot to
 * ask of a connection. The sidebar is how a session holds a whole raid's worth
 * and stays browsable.
 */
const MAX_WATCHING = 4

export function SessionView({ store, sessionId, fromShare, onSwitchSession }: Props) {
  const { session, loading, update } = useSession(store, sessionId)
  const { engine, state } = useTimeline()
  const wclClient = useMemo(() => createWclClient(), [])
  const twitchClient = useMemo(() => createTwitchClient(), [])

  const [watching, setWatching] = useState<string[]>([])
  const [reportInput, setReportInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [twitchConnected, setTwitchConnected] = useState(() => !!getStoredToken())
  /** Set while the share dialog is open; holds the link it is showing. */
  const [shareUrl, setShareUrl] = useState<string | undefined>()
  /** Whether the paste-a-roster box is open, and what it last complained about. */
  const [pasting, setPasting] = useState(false)
  const [pasteError, setPasteError] = useState<string | undefined>()
  /** Whether the notes panel is open. Per-session, not persisted. */
  const [notesOpen, setNotesOpen] = useState(false)
  /**
   * Arriving from a share link starts collapsed: everything needed to watch is
   * already set up, and the stream list is a setup surface. Every other way in
   * is someone building the session, who needs it.
   */
  const [sidebarOpen, setSidebarOpen] = useState(!fromShare)
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

  /**
   * Fills in a report that arrived without its fight list.
   *
   * Share links carry the report *code* and drop the fights, which are bulky and
   * re-fetchable — but that leaves the recipient looking at a session with no
   * pulls in it and no obvious reason why. This fetches them once the viewer's
   * own Warcraft Logs connection exists, so the link opens on a working session
   * rather than on an empty pull list with a refresh button to discover.
   *
   * Keyed by code so a report that genuinely fails does not retry in a loop.
   */
  const backfillRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const report = session?.report
    if (!report || report.fights.length > 0 || !wclClient) return
    if (backfillRef.current === report.code) return
    backfillRef.current = report.code

    void (async () => {
      try {
        const fetched = await wclClient.listFights(report.code)
        update((s) =>
          s.report?.code === fetched.code
            ? {
                ...s,
                report: { ...s.report, fights: fetched.fights, fetchedAt: Date.now() },
              }
            : s,
        )
      } catch {
        // Not signed in yet, or the report is private to someone else. The
        // report card's own refresh is the way back, and it says as much.
      }
    })()
  }, [session?.report, wclClient, update])

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
      update((s) => {
        // Refreshing the report you are already on must not throw away the pull
        // you are watching — a raid night in progress gains pulls while you look
        // at it, and refresh is how you see them. A *different* report is the
        // case the reset exists for: fight ids are only unique within a report,
        // so carrying one over would silently point at the wrong pull.
        const sameReport = s.report?.code === report.code
        return {
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
          selectedFightId: sameReport ? s.selectedFightId : undefined,
          markers: sameReport ? s.markers : [],
          deaths: sameReport ? s.deaths : [],
          events: sameReport ? s.events : [],
        }
      })
      setReportInput('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load that report.')
    } finally {
      setBusy(false)
    }
  }

  const selectFight = async (fight: VodFight) => {
    // Notes are kept: they carry the pull they belong to, so browsing attempts
    // no longer throws away what was written about the one you just left.
    update((s) => ({ ...s, selectedFightId: fight.fightId, deaths: [] }))
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
   * A guild acts as one entity: tick it and its members go on screen, untick
   * and they come off.
   *
   * Not exclusive — anyone else, in another guild or none, can still be picked
   * alongside. The only constraint is the overall cap, so a guild with more
   * members than remaining slots fills what it can rather than refusing.
   */
  const toggleGuildWatch = (guildId: string) => {
    const memberIds = session.streams
      .filter((s) => s.guildId === guildId && (s.resolved || s.source.kind === 'video'))
      .map((s) => s.id)
    if (memberIds.length === 0) return

    setWatching((current) => {
      const allOn = memberIds.every((id) => current.includes(id))
      if (allOn) return current.filter((id) => !memberIds.includes(id))

      const next = [...current]
      for (const id of memberIds) {
        if (next.length >= MAX_WATCHING) break
        if (!next.includes(id)) next.push(id)
      }
      return next
    })
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

  /**
   * Notes are markers. Same record, same share payload — the panel is a way to
   * read and write them as a list rather than a second kind of annotation.
   */
  const addNote = (atMs: number, label: string) => {
    const fightId = selectedFight?.fightId
    update((s) => ({
      ...s,
      markers: [...s.markers, { id: newId(), atMs, label, fightId }],
    }))
  }

  const editNote = (id: string, label: string, note: string | undefined, atMs: number) => {
    update((s) => ({
      ...s,
      markers: s.markers.map((m) => (m.id === id ? { ...m, label, note, atMs } : m)),
    }))
  }

  const removeNote = (id: string) => {
    update((s) => ({ ...s, markers: s.markers.filter((m) => m.id !== id) }))
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

  /**
   * Opens the share dialog.
   *
   * This used to write to the clipboard and say nothing, which was
   * indistinguishable from a dead button — and if the write was refused, it
   * genuinely was one. Showing the link means there is always something to copy
   * by hand, whatever the clipboard permission does.
   */
  const share = () => setShareUrl(buildShareUrl(session))

  /**
   * Notes for the pull on screen. Ones with no pull recorded are from before
   * notes were keyed, and are shown wherever you are rather than orphaned.
   */
  const pullMarkers = session.markers.filter(
    (m) => m.fightId === undefined || m.fightId === session.selectedFightId,
  )

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
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? 'Hide the stream list' : 'Show the stream list'}
        >
          {sidebarOpen ? '◧' : '▢'} Streams
        </button>
        <button
          onClick={() => setNotesOpen((v) => !v)}
          aria-pressed={notesOpen}
          title="Timestamped notes on this pull"
        >
          Notes{pullMarkers.length > 0 ? ` (${pullMarkers.length})` : ''}
        </button>
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

      <div
        className="review-body"
        data-sidebar={sidebarOpen ? 'on' : 'off'}
        data-notes={notesOpen ? 'on' : 'off'}
      >
        {/*
          The sidebar is a column with one growing section: the stream list and
          connection panels keep their natural height, and the pull browser
          takes the rest and scrolls on its own. A raid night is dozens of
          pulls, so it has to scroll without dragging the whole page with it.
        */}
        <aside className="pov-sidebar" hidden={!sidebarOpen}>
          <StreamSidebar
            streams={session.streams}
            guilds={session.guilds}
            watching={watching}
            maxWatching={MAX_WATCHING}
            audioStreamId={session.audioStreamId}
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
            onToggleGuildWatch={toggleGuildWatch}
            onDuplicate={duplicateStream}
            onMoveToGuild={moveToGuild}
            onAddGuild={addGuild}
            onRenameGuild={renameGuild}
            onRemoveGuild={removeGuild}
            onAdd={(draft) => void addStream(draft)}
            onEdit={editStream}
            onRemove={removeStream}
            rosterJson={() => exportRosterJson(session)}
            onImport={() => {
              setPasteError(undefined)
              setPasting(true)
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
              markers={pullMarkers}
              deaths={session.deaths}
              durationMs={selectedFight.durationMs}
              boundedByFight
              // The bar's own button opens the panel and lets you type there,
              // rather than raising a prompt: a note wants somewhere to be read
              // back, and that somewhere is the list.
              onAddMarker={() => setNotesOpen(true)}
              onSeekMarker={(m) => engine.seekTo(m.atMs)}
            />
          )}
        </main>

        {notesOpen && (
          <NotesPanel
            markers={pullMarkers}
            positionMs={state.positionMs}
            hasPull={!!selectedFight}
            onSeek={(m) => engine.seekTo(m.atMs)}
            onAdd={addNote}
            onEdit={editNote}
            onRemove={removeNote}
            onClose={() => setNotesOpen(false)}
          />
        )}
      </div>

      {shareUrl && (
        <ShareDialog
          url={shareUrl}
          onDownloadJson={downloadJson}
          onClose={() => setShareUrl(undefined)}
        />
      )}

      {pasting && (
        <PasteDialog
          title="Paste roster"
          confirmLabel="Replace roster"
          note="Replaces the stream list in this session. Guilds named in the paste are added if you do not already have them; the report and your notes are untouched."
          error={pasteError}
          onConfirm={(text) => {
            const imported = importRosterJson(text)
            if (!imported) {
              setPasteError('That is not a roster this version can read.')
              return
            }
            update((s) => {
              // Merge guilds by id rather than replacing: a paste that brings a
              // guild you already have must not duplicate it, and one that
              // brings a new guild must not leave its members homeless.
              const known = new Set(s.guilds.map((g) => g.id))
              return {
                ...s,
                streams: imported.streams,
                guilds: [...s.guilds, ...imported.guilds.filter((g) => !known.has(g.id))],
              }
            })
            setPasting(false)
          }}
          onClose={() => setPasting(false)}
        />
      )}
    </div>
  )
}
