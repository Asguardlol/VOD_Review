import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string'
import type { VodGuild, VodSession, VodStream } from './types'
import { newId } from './ids'
import { normalizeSession } from './normalize'

/**
 * Sharing without a server.
 *
 * A session is a report code, a handful of channel names, and some integers, so
 * the whole thing compresses small enough to live in a URL fragment. The
 * fragment is never sent to the server, which is exactly right here — GitHub
 * Pages could not do anything with it anyway.
 *
 * The cached fight list is the one bulky part, and it is deliberately dropped
 * on export: it is re-fetchable from the report code, and keeping it would blow
 * the link size for data the recipient's own token can retrieve.
 *
 * Practical ceiling: browsers and chat clients start truncating somewhere around
 * 8–32k characters. `encodeSession` reports the length so the UI can warn and
 * offer a JSON download instead of handing out a broken link.
 */

/** Past this, offer the JSON export instead — some clients will mangle the URL. */
export const URL_LENGTH_WARN_THRESHOLD = 8000

/**
 * Wire format. Deliberately versioned and separate from `VodSession`: a link
 * pasted into Discord today must still open after the app's model has moved on.
 */
interface SharePayloadV2 {
  v: 2
  session: VodSession
}

/**
 * Strips what the recipient can re-fetch. Keeps the report *code* so the app can
 * reload the fight list, but not the fights themselves.
 */
function slimForSharing(session: VodSession): VodSession {
  return {
    ...session,
    report: session.report
      ? { ...session.report, fights: [], fetchedAt: 0 }
      : undefined,
    deaths: [],
    events: [],
    // Resolved VODs are per-viewer anyway: they come from a lookup the
    // recipient will redo with their own Twitch connection.
    streams: session.streams.map((s) => ({ ...s, resolved: undefined })),
  }
}

export function encodeSession(session: VodSession): {
  fragment: string
  length: number
} {
  const payload: SharePayloadV2 = { v: 2, session: slimForSharing(session) }
  const fragment = compressToEncodedURIComponent(JSON.stringify(payload))
  return { fragment, length: fragment.length }
}

/**
 * Builds the full shareable URL.
 *
 * Hash-based routing means the payload rides after the route, so a deep link
 * works on Pages without a 404.html rewrite.
 */
export function buildShareUrl(session: VodSession, baseUrl?: string): string {
  const { fragment } = encodeSession(session)
  const origin = baseUrl ?? window.location.href.split('#')[0]
  return `${origin}#/shared/${fragment}`
}

/**
 * Decodes a shared session, returning `undefined` rather than throwing on
 * anything malformed — a truncated paste is the expected failure here, not an
 * exceptional one, and the caller shows a "link looks incomplete" message.
 */
export function decodeSession(fragment: string): VodSession | undefined {
  try {
    const json = decompressFromEncodedURIComponent(fragment)
    if (!json) return undefined
    const payload = JSON.parse(json) as SharePayloadV2
    if (payload?.v !== 2 || !payload.session) return undefined
    const session = payload.session
    if (!Array.isArray(session.streams)) return undefined
    return normalizeSession(session)
  } catch {
    return undefined
  }
}

/**
 * What to do with an opened share link.
 *
 * The id travels in the payload, so a link is a stable handle on one session
 * rather than a new session every time it is opened. Re-sending an updated link
 * for the same night therefore updates what the recipient already has instead
 * of leaving them with six near-identical copies to tell apart.
 *
 * That only holds while the recipient agrees to it, which is why this is a
 * choice and not a rule: their copy may carry markers they wrote and broadcast
 * delays they tuned, and none of that can be merged with an incoming version.
 * The caller asks; this just carries out the answer.
 */
export type ShareAdoption = 'update-in-place' | 'as-new-copy'

export function adoptSharedSession(
  session: VodSession,
  adoption: ShareAdoption,
): VodSession {
  const now = Date.now()
  if (adoption === 'update-in-place') return { ...session, updatedAt: now }
  return {
    ...session,
    id: newId(),
    publicId: undefined,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Just the roster: who is in this session and which guilds they belong to.
 *
 * Separate from the session export because it answers a different question —
 * "here are my raiders" rather than "here is this night" — and it is the thing
 * worth moving between sessions.
 *
 * The guilds travel with it, and only the ones actually referenced. A stream
 * carries a `guildId`, and pasting one into a session that has never heard of
 * that guild puts it in a group that does not exist: the sidebar lists members
 * per known guild and the ungrouped separately, so such a stream renders in
 * neither and silently disappears while still being in the data.
 */
interface RosterPayload {
  v: 2
  streams: VodStream[]
  guilds: VodGuild[]
}

export function exportRosterJson(session: VodSession): string {
  const used = new Set(session.streams.map((s) => s.guildId).filter(Boolean))
  const payload: RosterPayload = {
    v: 2,
    // Resolved VODs are specific to one report and one viewer's Twitch token.
    streams: session.streams.map((s) => ({
      ...s,
      resolved: undefined,
      unavailableReason: undefined,
    })),
    guilds: session.guilds.filter((g) => used.has(g.id)),
  }
  return JSON.stringify(payload, null, 2)
}

/**
 * Reads a pasted roster.
 *
 * Accepts a full session export too, since that is the other thing someone
 * plausibly has on their clipboard and it contains everything needed.
 */
export function importRosterJson(
  text: string,
): { streams: VodStream[]; guilds: VodGuild[] } | undefined {
  try {
    const parsed = JSON.parse(text) as Partial<RosterPayload> & {
      session?: VodSession
    }
    const source = parsed.session ?? parsed
    if (!Array.isArray(source.streams)) return undefined
    const normalized = normalizeSession({
      ...(source as VodSession),
      guilds: source.guilds ?? [],
    })
    return { streams: normalized.streams, guilds: normalized.guilds }
  } catch {
    return undefined
  }
}

export function exportSessionJson(session: VodSession): string {
  return JSON.stringify({ v: 2, session } satisfies SharePayloadV2, null, 2)
}

export function importSessionJson(text: string): VodSession | undefined {
  try {
    const payload = JSON.parse(text) as SharePayloadV2
    if (payload?.v !== 2 || !payload.session) return undefined
    // A file is not a link: it has no id worth honouring here, since importing
    // one only lifts its stream list into the session already open.
    return adoptSharedSession(normalizeSession(payload.session), 'as-new-copy')
  } catch {
    return undefined
  }
}
