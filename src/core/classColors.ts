import type { WowClass } from './types'

/**
 * Blizzard's class colours.
 *
 * Used for death lines on the timeline: at a glance you want to see "three
 * healers died in four seconds" without reading a single name.
 */
export const CLASS_COLORS: Record<WowClass, string> = {
  'death-knight': '#C41E3A',
  'demon-hunter': '#A330C9',
  druid: '#FF7C0A',
  evoker: '#33937F',
  hunter: '#AAD372',
  mage: '#3FC7EB',
  monk: '#00FF98',
  paladin: '#F48CBA',
  priest: '#FFFFFF',
  rogue: '#FFF468',
  shaman: '#0070DD',
  warlock: '#8788EE',
  warrior: '#C69B6D',
}
