/**
 * Timeline positions are shown as m:ss, or h:mm:ss once a review runs past an
 * hour. Offsets can be negative (a POV that started recording after timeline
 * zero), so the sign is handled explicitly rather than assumed away.
 */
export function formatTime(ms: number): string {
  const negative = ms < 0
  const total = Math.floor(Math.abs(ms) / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const body =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`
  return negative ? `-${body}` : body
}

/** Precise form for the sync readout, where a tenth of a second matters. */
export function formatPrecise(ms: number): string {
  const sign = ms < 0 ? '-' : ''
  const abs = Math.abs(ms)
  return `${sign}${formatTime(abs).replace(/^-/, '')}.${Math.floor((abs % 1000) / 100)}`
}
