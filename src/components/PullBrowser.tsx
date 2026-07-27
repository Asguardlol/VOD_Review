import { useMemo, useState } from 'react'
import type { SessionReport, VodFight } from '../core/types'
import { formatAge, formatClock, formatTime } from '../core/format'
import { colorForPull } from '../core/wclColors'

interface Props {
  report: SessionReport
  selectedFightId?: number
  busy?: boolean
  onSelect(fight: VodFight): void
  onRefresh(): void
  onRemove(): void
}

/**
 * The pull browser — the spine of the app.
 *
 * Pulls group by encounter, and encounters sort by most recent activity, so the
 * boss you were just working on is at the top. That matches how a review
 * actually starts: you finish raid, you want the last thing you wiped to.
 */
export function PullBrowser({
  report,
  selectedFightId,
  busy,
  onSelect,
  onRefresh,
  onRemove,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const groups = useMemo(() => {
    const byEncounter = new Map<number, { name: string; fights: VodFight[] }>()
    for (const fight of report.fights) {
      const group = byEncounter.get(fight.encounterId) ?? {
        name: `${fight.encounterName}${
          fight.difficultyName ? ` ${fight.difficultyName}` : ''
        }`,
        fights: [],
      }
      group.fights.push(fight)
      byEncounter.set(fight.encounterId, group)
    }
    return [...byEncounter.entries()]
      .map(([encounterId, group]) => ({
        encounterId,
        name: group.name,
        // Pull order within a boss reads naturally as 1, 2, 3…
        fights: [...group.fights].sort((a, b) => a.startedAt - b.startedAt),
        latest: Math.max(...group.fights.map((f) => f.startedAt)),
      }))
      .sort((a, b) => b.latest - a.latest)
  }, [report.fights])

  const toggle = (encounterId: number) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(encounterId)) next.delete(encounterId)
      else next.add(encounterId)
      return next
    })
  }

  return (
    <div className="pull-browser">
      <div className="report-card">
        <div className="report-meta">
          <strong>{report.title}</strong>
          <span className="dim">
            {report.fetchedAt ? formatAge(report.fetchedAt) : 'not loaded yet'}
          </span>
        </div>
        <button
          className="icon-button"
          title="Reload the pull list — a live raid gains pulls while you watch"
          onClick={onRefresh}
          disabled={busy}
        >
          {busy ? '…' : '⟳'}
        </button>
        <button className="icon-button" title="Remove this report" onClick={onRemove}>
          ✕
        </button>
      </div>

      {report.fights.length === 0 && !busy && (
        <p className="sidebar-empty dim">
          No encounter pulls in this report — trash-only reports have nothing to
          review.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.encounterId} className="encounter">
          <button className="encounter-head" onClick={() => toggle(group.encounterId)}>
            <span>{group.name}</span>
            <span className="chevron">{collapsed.has(group.encounterId) ? '›' : '⌄'}</span>
          </button>

          {!collapsed.has(group.encounterId) && (
            <div className="pull-grid">
              {group.fights.map((fight) => (
                <PullTile
                  key={fight.fightId}
                  fight={fight}
                  selected={fight.fightId === selectedFightId}
                  onSelect={() => onSelect(fight)}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

function PullTile({
  fight,
  selected,
  onSelect,
}: {
  fight: VodFight
  selected: boolean
  onSelect(): void
}) {
  /*
   * The bar is the whole point of the tile: scanning twenty attempts, you want
   * to see how far each got without reading a number. A kill fills it; a wipe
   * fills it by how much boss health was taken off.
   */
  const progress = fight.kill
    ? 100
    : fight.bossPercentage != null
      ? Math.min(100, Math.max(0, 100 - fight.bossPercentage))
      : 0

  // Warcraft Logs' own tier colours, so a pull reads the same here as it does
  // in the log — no second colour language to learn.
  const color = colorForPull(!!fight.kill, fight.bossPercentage)

  return (
    <button
      className={`pull-tile${selected ? ' selected' : ''}`}
      onClick={onSelect}
      title={
        fight.kill
          ? `Pull ${fight.pullNumber} — kill`
          : `Pull ${fight.pullNumber} — wipe${
              fight.bossPercentage != null ? ` at ${fight.bossPercentage}%` : ''
            }`
      }
    >
      <span className="pull-line">
        <span className="pull-number" style={{ color }}>
          {fight.pullNumber}
        </span>
        <span className="pull-duration">({formatTime(fight.durationMs)})</span>
        <span className="pull-clock">{formatClock(fight.startedAt)}</span>
      </span>
      <span className="pull-bar">
        <span
          className="pull-bar-fill"
          style={{ width: `${progress}%`, background: color }}
        />
      </span>
    </button>
  )
}
