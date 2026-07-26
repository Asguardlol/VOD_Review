import type { ResolvedVod, VodFight, VodStream } from './types'

/**
 * Converting between the two clocks.
 *
 * The timeline engine only understands "how far into this video does timeline
 * zero fall". Everything absolute — VOD start times, pull start times,
 * broadcast delay — is reconciled here, so the engine stays a dumb, testable
 * state machine and this is the only place the arithmetic lives.
 */

/** The video a stream will actually play, whichever source it came from. */
export function vodForStream(stream: VodStream): ResolvedVod | undefined {
  if (stream.source.kind === 'video') {
    const { platform, videoId, startedAt } = stream.source
    // A manually added video with no known start can still be played; it just
    // can't be placed on the absolute clock, so pull auto-seek won't work.
    return startedAt === undefined
      ? undefined
      : { platform, videoId, startedAt, durationMs: 0 }
  }
  return stream.resolved
}

/**
 * Where timeline zero (pull start) falls inside this stream's video, in ms.
 *
 * `pull start − VOD start` is the raw position; adding the broadcast delay
 * shifts it later, because a delayed stream shows a given moment later in its
 * own recording than it happened.
 *
 * Returns undefined when the stream can't be placed — no resolved VOD, or a
 * manual video with no known start time. Callers must treat that as "this
 * stream cannot follow the timeline", not as zero.
 */
export function timelineOffsetMs(
  stream: VodStream,
  fight: VodFight,
): number | undefined {
  const vod = vodForStream(stream)
  if (!vod) return undefined
  return fight.startedAt - vod.startedAt + stream.offsetMs
}

/**
 * Whether this stream's VOD actually covers the pull.
 *
 * A VOD that started after the pull ended, or ended before it began, has no
 * footage of it — playing it would show unrelated content, which is worse than
 * saying so.
 */
export function coversPull(stream: VodStream, fight: VodFight): boolean {
  const vod = vodForStream(stream)
  if (!vod) return false
  // A zero duration means "unknown length" (manual video), so don't rule it out.
  if (vod.durationMs <= 0) return fight.startedAt >= vod.startedAt

  const offset = timelineOffsetMs(stream, fight)
  if (offset === undefined) return false
  return offset >= 0 && offset + fight.durationMs <= vod.durationMs
}

/** The default Twitch broadcast delay, and the starting value for a new stream. */
export const DEFAULT_BROADCAST_DELAY_MS = 4000
