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

/** Wall-clock time of a pull, e.g. "10:23 PM". */
export function formatClock(unixMs: number): string {
  return new Date(unixMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * How old a report is, coarsely. Precision past "days" is not useful here — the
 * question is only whether the cached fight list is worth refreshing.
 */
export function formatAge(unixMs: number): string {
  const seconds = Math.max(0, (Date.now() - unixMs) / 1000)
  if (seconds < 90) return 'just now'
  const minutes = seconds / 60
  if (minutes < 60) return `${Math.round(minutes)} minutes ago`
  const hours = minutes / 60
  if (hours < 24) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Reads a timestamp someone typed: "2:13", "1:02:30", or a bare "90" meaning
 * ninety seconds. Returns undefined for anything it cannot read, so the caller
 * can refuse the input rather than silently store a zero.
 */
export function parseTimeInput(text: string): number | undefined {
  const parts = text.trim().split(':')
  if (parts.length > 3) return undefined
  let total = 0
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return undefined
    total = total * 60 + Number(part)
  }
  return total * 1000
}

/** Precise form for the sync readout, where a tenth of a second matters. */
export function formatPrecise(ms: number): string {
  const sign = ms < 0 ? '-' : ''
  const abs = Math.abs(ms)
  return `${sign}${formatTime(abs).replace(/^-/, '')}.${Math.floor((abs % 1000) / 100)}`
}
