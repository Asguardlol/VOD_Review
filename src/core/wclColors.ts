/**
 * Warcraft Logs' quality-tier colour scale.
 *
 * These are the colours WCL uses everywhere it grades something, and they are
 * WoW's own item-quality colours — which is why they read as "how good was
 * this" to any raider without a legend.
 */
export const WCL_TIER_COLORS = {
  common: '#666666',
  uncommon: '#1eff00',
  rare: '#0070ff',
  epic: '#a335ee',
  legendary: '#ff8000',
  astounding: '#e268a8',
} as const

export type WclTier = keyof typeof WCL_TIER_COLORS

/**
 * Grades a pull by how far it got, using WCL's own thresholds for their tiers.
 *
 * A kill is the top tier outright. Wipes are graded on boss health removed, so
 * scanning a night's attempts shows progress the same way the log itself does:
 * a purple pull was a good one, a grey pull was an early reset.
 */
export function tierForPull(kill: boolean, bossPercentage?: number): WclTier {
  if (kill) return 'astounding'
  if (bossPercentage == null) return 'common'

  const progress = 100 - bossPercentage
  if (progress >= 95) return 'legendary'
  if (progress >= 75) return 'epic'
  if (progress >= 50) return 'rare'
  if (progress >= 25) return 'uncommon'
  return 'common'
}

export function colorForPull(kill: boolean, bossPercentage?: number): string {
  return WCL_TIER_COLORS[tierForPull(kill, bossPercentage)]
}
