/**
 * Warcraft Logs' quality-tier colour scale.
 *
 * These are the colours WCL uses everywhere it grades something, and they are
 * WoW's own item-quality colours — which is why they read as "how good was
 * this" to any raider without a legend.
 */
export const WCL_TIER_COLORS = {
  common: '#ffffff',
  uncommon: '#1eff00',
  rare: '#0070ff',
  epic: '#a335ee',
  legendary: '#ff8000',
  astounding: '#e268a8',
} as const

export type WclTier = keyof typeof WCL_TIER_COLORS

/**
 * Kills get their own colour, outside the tier scale.
 *
 * A kill is a different kind of result, not the best wipe — grading it on the
 * same scale invites reading it as "99%+ damage done" rather than "done". A
 * light green reads as finished at a glance and stays clear of the neon green
 * used for the 25–49% band.
 */
export const KILL_COLOR = '#90ee90'

/**
 * WCL's percentile bands, which are not evenly spaced.
 *
 * The top two are deliberately narrow: orange starts at 95 and pink at 99,
 * because the whole point of the scale is to distinguish very good from
 * nearly-perfect. Spacing these evenly would wash that distinction out.
 */
const BANDS: [threshold: number, tier: WclTier][] = [
  [99, 'astounding'],
  [95, 'legendary'],
  [75, 'epic'],
  [50, 'rare'],
  [25, 'uncommon'],
]

/**
 * Grades a wipe by how far it got, using WCL's bands.
 *
 * Scanning a night's attempts then shows progress the way the log itself does:
 * a purple pull was a good one, a white pull was an early reset.
 */
export function tierForPull(bossPercentage?: number): WclTier {
  if (bossPercentage == null) return 'common'
  const progress = 100 - bossPercentage
  return BANDS.find(([threshold]) => progress >= threshold)?.[1] ?? 'common'
}

export function colorForPull(kill: boolean, bossPercentage?: number): string {
  return kill ? KILL_COLOR : WCL_TIER_COLORS[tierForPull(bossPercentage)]
}
