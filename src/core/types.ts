/**
 * Core data model for multi-POV VOD review.
 *
 * A review is a set of recordings of the same pull, each with an offset onto one
 * shared timeline. Seeking the timeline to `t` means seeking POV `p` to
 * `t + p.offsetMs`.
 *
 * This file is intentionally self-contained — see CLAUDE.md. The raid planner is
 * a separate project and must not be imported from.
 */

export type VodPlatform = 'youtube' | 'twitch'

/**
 * One player's point of view within a review.
 */
export interface VodPov {
  id: string
  platform: VodPlatform
  /**
   * YouTube video id, or Twitch VOD/highlight id.
   *
   * Twitch *clips* are deliberately not supported: they use a separate embed
   * (`clips.twitch.tv/embed`) with no `seek()` or `getCurrentTime()`, so a clip
   * cannot be driven from a shared timeline at all. Only the Twitch Player API
   * (`video:` ids — VODs and highlights) can participate here.
   */
  videoId: string
  /** Whose POV. Free text so a POV can be added before any roster exists. */
  label: string
  /** Optional link to a roster member, when one is known. */
  rosterMemberId?: string
  /**
   * How far into this video the shared timeline's zero point falls.
   *
   * Set by the "sync here" control. Neither platform seeks frame-accurately
   * (expect ~±0.3s), so treat this as the target for continuous drift
   * correction, not a value you set once and trust.
   */
  offsetMs: number
  /** Grouping key so large reviews stay browsable. */
  vodGuildId?: string
  /**
   * Set when the platform refuses to embed this video, so the UI can explain
   * rather than showing a black box.
   *
   * `vod-expired` is the common one on Twitch and it is not a bug: plain VODs
   * are deleted after ~14 days (~60 for Partners/Turbo). Only *highlights* are
   * permanent, so a review more than a couple of weeks old will rot unless the
   * raider saved their VOD as a highlight first.
   */
  unavailableReason?:
    | 'embed-disabled'
    | 'age-restricted'
    | 'not-found'
    | 'vod-expired'
}

/**
 * A team/guild grouping for POVs.
 *
 * The reason this exists: raidplan.io caps at four POVs with no organization. A
 * 20-person raid produces more angles than that, and grouping is what keeps a
 * large review navigable.
 */
export interface VodGuild {
  id: string
  name: string
  color?: string
}

/** A bookmarked moment on the shared timeline. */
export interface VodMarker {
  id: string
  atMs: number
  label: string
  note?: string
}

// ---------------------------------------------------------------------------
// Warcraft Logs
// ---------------------------------------------------------------------------

/**
 * The pull a review is about, pulled from a Warcraft Logs report.
 *
 * Attaching one changes what timeline zero means: it becomes **pull start**
 * rather than an arbitrary point the user picked. That is what lets log event
 * times (deaths especially) be placed on the same timeline as the videos, and it
 * bounds the scrub bar by the fight rather than by the longest VOD.
 *
 * Optional throughout the app — a review with no log still works, it just has no
 * death lines and an unbounded timeline.
 */
export interface VodFight {
  /** Report code from the WCL URL, e.g. `aBcDeF123`. */
  reportCode: string
  /** Fight id within that report. Unique per report, not globally. */
  fightId: number
  encounterId: number
  encounterName: string
  /** Which attempt this was, as WCL numbers them. */
  pullNumber?: number
  /** WCL difficulty id (3 normal, 4 heroic, 5 mythic for raids). */
  difficulty?: number
  difficultyName?: string
  kill?: boolean
  /** Best percentage reached, for a wipe. */
  bossPercentage?: number
  /** Fight length. This is what the scrub bar spans. */
  durationMs: number
  /**
   * Report-relative start/end in ms, exactly as WCL reports them. Kept so
   * further queries against the same report can be re-scoped without refetching
   * the fight list.
   */
  startTime: number
  endTime: number
}

/**
 * One death during the pull.
 *
 * `atMs` is relative to pull start, which is timeline zero whenever a fight is
 * attached — so a death renders on the scrub bar with no further conversion.
 */
export interface VodDeath {
  id: string
  atMs: number
  playerName: string
  wowClass?: WowClass
  /** The ability that killed them, when the log records one. */
  killingBlow?: string
  /** WCL actor id, so a death can be matched to a POV's raider later. */
  sourceActorId?: number
}

export interface VodReview {
  id: string
  /** Appears in share URLs. Distinct from `id` so local and shared ids differ. */
  publicId?: string
  title: string
  guilds: VodGuild[]
  povs: VodPov[]
  markers: VodMarker[]
  /**
   * Which POV is audible. Everything else plays muted.
   *
   * N simultaneous audio streams is unusable, and browsers only exempt *muted*
   * media from the autoplay gesture requirement — so muting the rest is what
   * makes starting many players at once work at all.
   */
  audioPovId?: string
  /**
   * The pull this review covers, when one has been attached from Warcraft Logs.
   *
   * When set, timeline zero is pull start and the scrub bar spans the fight.
   * When absent everything still works — the timeline is just bounded by the
   * longest VOD instead, and there are no death lines.
   */
  fight?: VodFight
  /** Deaths during the pull, from the log. Empty when no log is attached. */
  deaths: VodDeath[]
  /**
   * Optional link back to a raid plan this review is about — a URL or id only.
   * This is the seam between the two projects; do not couple them in code.
   */
  planUrl?: string
  createdAt: number
  updatedAt: number
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
 * A raider, for labeling POVs.
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
