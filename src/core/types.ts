/**
 * Core data model for multi-POV VOD review.
 *
 * ## The model, and why it looks like this
 *
 * A **session** is one raid night: a Warcraft Logs report plus the people who
 * streamed it. Each stream is the *whole night's* VOD, not a clip per pull.
 * Selecting a pull seeks every stream into its own night VOD at the matching
 * wall-clock moment.
 *
 * That is what makes `offsetMs` mean **broadcast delay** — how far a streamer's
 * video lags real time — rather than "where timeline zero falls". You set it
 * once per person per night and every pull in the report then lines up, instead
 * of re-syncing for each pull.
 *
 * Two clocks are in play and it matters which is which:
 *   - **absolute** (unix ms): when things actually happened. Log timestamps and
 *     VOD start times live here, and it is how a pull is matched to a VOD.
 *   - **pull-relative** (ms from pull start): what the transport shows and what
 *     death markers are placed on.
 *
 * This file is intentionally self-contained — see CLAUDE.md. The raid planner is
 * a separate project and must not be imported from.
 */

export type VodPlatform = 'youtube' | 'twitch'

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

/**
 * Where a stream's video comes from.
 *
 * A discriminated union rather than a Twitch login string, because the two
 * cases genuinely differ in what the app can do:
 *
 * - `twitch-channel` — the app resolves which VOD covers the report's time
 *   range. Type a name once and every pull works. Needs the Twitch API.
 * - `video` — an explicit video. The only option for YouTube, which has no
 *   equivalent lookup, and the fallback when a Twitch VOD can't be resolved.
 *   Without a known `startedAt` the app cannot place it on the absolute clock,
 *   so pull selection can't auto-seek it and the offset is set by hand.
 */
export type StreamSource =
  | { kind: 'twitch-channel'; login: string }
  | {
      kind: 'video'
      platform: VodPlatform
      videoId: string
      /** Unix ms the recording started, if known. Required for auto-seek. */
      startedAt?: number
    }

/** Raid role, used for the sidebar icon. Mirrors how raidplan labels them. */
export type StreamRole = 'tank' | 'healer' | 'mdps' | 'rdps'

/**
 * A guild/team grouping for streams.
 *
 * The reason this exists: a review holds far more angles than can play at once,
 * and grouping is what keeps a large one navigable. Selecting a guild scopes
 * what you can watch to its members, so you pick a guild and then pick people
 * within it rather than hunting through one flat list of twenty names.
 */
export interface VodGuild {
  id: string
  name: string
  color?: string
}

/**
 * One person's stream for the night.
 */
export interface VodStream {
  id: string
  source: StreamSource
  /** Display name in the sidebar. Free text — not tied to a roster. */
  label: string
  role?: StreamRole
  /** Drives the icon colour. */
  wowClass?: WowClass
  /** Which guild this person is in. Absent means ungrouped. */
  guildId?: string
  /**
   * Broadcast delay in milliseconds: how far this stream's video lags the real
   * events in the log. Twitch's default is around 4 seconds, which is why that
   * is the starting value rather than zero.
   *
   * Neither platform seeks frame-accurately (~±0.3s), so this is the target for
   * continuous drift correction, not a value set once and trusted.
   */
  offsetMs: number
  /**
   * The VOD found to cover the current report, cached from the last lookup.
   *
   * Cache, never the source of truth: it is recomputed whenever the report
   * changes, and its absence is what greys a stream out.
   */
  resolved?: ResolvedVod
  /** Why this stream has no usable video, so the UI can say rather than hide. */
  unavailableReason?: StreamUnavailableReason
}

export type StreamUnavailableReason =
  | 'no-vod-in-range'
  | 'embed-disabled'
  | 'age-restricted'
  | 'not-found'
  | 'vod-expired'
  | 'channel-not-found'

/** A concrete video known to cover part of the report's time range. */
export interface ResolvedVod {
  platform: VodPlatform
  videoId: string
  /** Unix ms the recording started. The anchor for all absolute-time maths. */
  startedAt: number
  durationMs: number
  title?: string
}

// ---------------------------------------------------------------------------
// Warcraft Logs
// ---------------------------------------------------------------------------

/**
 * One pull from a report.
 *
 * Carries both clocks on purpose: `startTime`/`endTime` are report-relative (as
 * WCL returns them, and what further queries need), while `startedAt` is
 * absolute and is what matches a pull to a VOD.
 */
export interface VodFight {
  reportCode: string
  /** Fight id within that report. Unique per report, not globally. */
  fightId: number
  encounterId: number
  encounterName: string
  /** Which attempt this was, as WCL numbers them per encounter. */
  pullNumber?: number
  /** WCL difficulty id (3 normal, 4 heroic, 5 mythic for raids). */
  difficulty?: number
  difficultyName?: string
  kill?: boolean
  /**
   * Boss health remaining at wipe, as a percentage. Drives the progress bar on
   * a pull tile — the single most useful thing to see when scanning attempts.
   */
  bossPercentage?: number
  durationMs: number
  /** Report-relative ms, exactly as WCL reports them. */
  startTime: number
  endTime: number
  /** Unix ms. Derived from the report's start; used to locate a pull in a VOD. */
  startedAt: number
}

/**
 * One death during a pull. `atMs` is relative to pull start.
 */
export interface VodDeath {
  id: string
  atMs: number
  playerName: string
  wowClass?: WowClass
  killingBlow?: string
  sourceActorId?: number
}

/** A notable timed event drawn as its own marker layer on the transport. */
export interface VodEvent {
  id: string
  atMs: number
  kind: 'lust'
  label: string
}

/**
 * An attached report, with its fight list cached.
 *
 * `fetchedAt` exists so the UI can show how stale the data is and offer a
 * refresh, the way raidplan does — a report from an in-progress raid night
 * gains pulls while you are looking at it.
 */
export interface SessionReport {
  code: string
  title: string
  /** Unix ms. WCL's report start; all fight times are offsets from it. */
  startTime: number
  endTime: number
  fights: VodFight[]
  fetchedAt: number
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * One raid night's review.
 *
 * There is no "create a session" step in the UI — you land on a working surface
 * and it fills in as you paste a report and add streams. This exists so that
 * state can be persisted and shared, not as something the user names first.
 */
export interface VodSession {
  id: string
  /** Appears in share URLs. Distinct from `id` so local and shared ids differ. */
  publicId?: string
  /** Derived from the report when there is one; editable. */
  title: string
  report?: SessionReport
  streams: VodStream[]
  guilds: VodGuild[]
  /** Which pull is loaded. Fight ids are per-report, so this pairs with report. */
  selectedFightId?: number
  /** Deaths for the selected pull only, refetched on selection. */
  deaths: VodDeath[]
  /** Other marker layers (currently Lust) for the selected pull. */
  events: VodEvent[]
  /** Which stream is audible. Everything else plays muted. */
  audioStreamId?: string
  /** User-placed bookmarks on the selected pull. */
  markers: VodMarker[]
  /**
   * Optional link back to a raid plan — a URL or id only. This is the seam
   * between the two projects; do not couple them in code.
   */
  planUrl?: string
  createdAt: number
  updatedAt: number
}

/**
 * A note on a moment, relative to the pull's start.
 *
 * `fightId` is what stops notes being destroyed by browsing: they used to be a
 * flat list on the session and were cleared whenever a pull was selected, so
 * looking at another attempt threw away everything written about this one.
 * Optional only for markers written before this existed, which are shown
 * against whichever pull is open.
 */
export interface VodMarker {
  id: string
  atMs: number
  label: string
  note?: string
  fightId?: number
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export type WowClass =
  | 'death-knight'
  | 'demon-hunter'
  | 'druid'
  | 'evoker'
  | 'hunter'
  | 'mage'
  | 'monk'
  | 'paladin'
  | 'priest'
  | 'rogue'
  | 'shaman'
  | 'warlock'
  | 'warrior'

export type RaidRole = 'tank' | 'healer' | 'melee' | 'ranged'

/**
 * A raider, for labeling streams.
 *
 * Only `name` is required. Everything else is optional so names can be typed in
 * fast and enriched later without a migration — the user asked for this
 * explicitly on the planner side, and the same reasoning applies here.
 *
 * This is a local copy, deliberately. The planner has its own; they are allowed
 * to drift.
 */
export interface RosterMember {
  id: string
  name: string
  wowClass?: WowClass
  spec?: string
  role?: RaidRole
  discordHandle?: string
  notes?: string
}
