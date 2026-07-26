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
