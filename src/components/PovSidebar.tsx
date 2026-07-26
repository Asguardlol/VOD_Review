import type { VodGuild, VodPov } from '../core/types'
import { MenuButton } from './MenuButton'

interface Props {
  guilds: VodGuild[]
  povs: VodPov[]
  watching: string[]
  maxWatching: number
  audioPovId?: string
  onToggleWatch(povId: string): void
  onSoloWatch(povId: string): void
  onMakeAudio(povId: string): void
  onRenamePov(pov: VodPov): void
  onRemovePov(povId: string): void
  onMovePov(povId: string, guildId: string | undefined): void
  onAddGuild(): void
  onRenameGuild(guild: VodGuild): void
  onRemoveGuild(guildId: string): void
}

/**
 * The POV selector, down the side.
 *
 * A review can hold a whole raid's worth of angles but only four can play at
 * once, so browsing and watching are separate actions: this list is the browser,
 * and the checkbox is what promotes a POV into the grid. Clicking the name
 * instead solos it, which is the common case — one stream is the default.
 */
export function PovSidebar({
  guilds,
  povs,
  watching,
  maxWatching,
  audioPovId,
  onToggleWatch,
  onSoloWatch,
  onMakeAudio,
  onRenamePov,
  onRemovePov,
  onMovePov,
  onAddGuild,
  onRenameGuild,
  onRemoveGuild,
}: Props) {
  const atCapacity = watching.length >= maxWatching
  const ungrouped = povs.filter((p) => !p.vodGuildId)

  const renderPov = (pov: VodPov) => {
    const isWatching = watching.includes(pov.id)
    return (
      <li key={pov.id} className={isWatching ? 'watching' : undefined}>
        <input
          type="checkbox"
          checked={isWatching}
          // Capacity blocks adding, never removing — otherwise the user hits
          // four and can no longer uncheck anything.
          disabled={!isWatching && atCapacity}
          title={
            !isWatching && atCapacity
              ? `Already watching ${maxWatching}. Uncheck one first.`
              : isWatching
                ? 'Stop watching'
                : 'Watch alongside'
          }
          onChange={() => onToggleWatch(pov.id)}
        />
        <button
          className="sidebar-pov-name"
          title="Show only this POV"
          onClick={() => onSoloWatch(pov.id)}
        >
          {pov.label || 'Unnamed POV'}
          {pov.unavailableReason && (
            <span className="pov-warn" title="This video will not play">
              {' '}
              ⚠
            </span>
          )}
        </button>
        <MenuButton
          actions={[
            {
              label: audioPovId === pov.id ? 'Already the audio POV' : 'Listen to this POV',
              onSelect: () => onMakeAudio(pov.id),
              disabled: audioPovId === pov.id,
            },
            { label: 'Rename…', onSelect: () => onRenamePov(pov) },
            ...guilds
              .filter((g) => g.id !== pov.vodGuildId)
              .map((g) => ({
                label: `Move to ${g.name}`,
                onSelect: () => onMovePov(pov.id, g.id),
              })),
            ...(pov.vodGuildId
              ? [{ label: 'Remove from group', onSelect: () => onMovePov(pov.id, undefined) }]
              : []),
            {
              label: 'Delete POV',
              destructive: true,
              confirm: `Remove "${pov.label || 'this POV'}" from the review?`,
              onSelect: () => onRemovePov(pov.id),
            },
          ]}
        />
      </li>
    )
  }

  return (
    <aside className="pov-sidebar">
      <div className="sidebar-header">
        <span>
          POVs · watching {watching.length}/{maxWatching}
        </span>
        <MenuButton actions={[{ label: 'Add group…', onSelect: onAddGuild }]} />
      </div>

      {guilds.map((guild) => {
        const members = povs.filter((p) => p.vodGuildId === guild.id)
        return (
          <section key={guild.id} className="sidebar-group">
            <h3>
              <span
                className="guild-swatch"
                style={guild.color ? { background: guild.color } : undefined}
              />
              {guild.name}
              <span className="dim"> ({members.length})</span>
              <MenuButton
                actions={[
                  { label: 'Rename group…', onSelect: () => onRenameGuild(guild) },
                  {
                    label: 'Delete group',
                    destructive: true,
                    // Deleting a group must not delete footage. POVs fall back
                    // to ungrouped, which is recoverable; losing them isn't.
                    confirm: `Delete group "${guild.name}"? Its ${members.length} POV${
                      members.length === 1 ? '' : 's'
                    } will move to Ungrouped, not be deleted.`,
                    onSelect: () => onRemoveGuild(guild.id),
                  },
                ]}
              />
            </h3>
            {members.length === 0 ? (
              <p className="sidebar-empty dim">No POVs in this group</p>
            ) : (
              <ul>{members.map(renderPov)}</ul>
            )}
          </section>
        )
      })}

      <section className="sidebar-group">
        {guilds.length > 0 && (
          <h3>
            Ungrouped<span className="dim"> ({ungrouped.length})</span>
          </h3>
        )}
        {ungrouped.length === 0 ? (
          guilds.length > 0 && <p className="sidebar-empty dim">Nothing ungrouped</p>
        ) : (
          <ul>{ungrouped.map(renderPov)}</ul>
        )}
      </section>
    </aside>
  )
}
