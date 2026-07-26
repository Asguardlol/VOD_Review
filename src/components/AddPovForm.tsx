import { useState } from 'react'
import { parseVodUrl } from '../core/vodUrl'
import type { VodGuild, VodPov } from '../core/types'
import { newId } from '../core/ids'

interface Props {
  guilds: VodGuild[]
  defaultGuildId?: string
  onAdd(pov: VodPov): void
}

/**
 * Adding a POV is: paste the link the raider sent, name it, pick a group.
 *
 * Errors are shown inline and specific — "Twitch clips cannot be synced" is far
 * more useful than "invalid URL", and it's the mistake people will actually make.
 */
export function AddPovForm({ guilds, defaultGuildId, onAdd }: Props) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [guildId, setGuildId] = useState(defaultGuildId ?? '')
  const [error, setError] = useState<string | undefined>()

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = parseVodUrl(url)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    onAdd({
      id: newId(),
      platform: parsed.vod.platform,
      videoId: parsed.vod.videoId,
      label: label.trim() || 'Unnamed POV',
      // A timestamp in the pasted link is already a sync point — the raider
      // linked the moment they meant. Better than starting everyone at zero.
      offsetMs: parsed.vod.startMs ?? 0,
      vodGuildId: guildId || undefined,
    })
    setUrl('')
    setLabel('')
    setError(undefined)
  }

  return (
    <form className="add-pov" onSubmit={submit}>
      <input
        value={url}
        onChange={(e) => {
          setUrl(e.target.value)
          setError(undefined)
        }}
        placeholder="Paste a YouTube or Twitch VOD link"
        aria-label="Video URL"
      />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Whose POV?"
        aria-label="POV label"
      />
      <select value={guildId} onChange={(e) => setGuildId(e.target.value)} aria-label="Group">
        <option value="">No group</option>
        {guilds.map((guild) => (
          <option key={guild.id} value={guild.id}>
            {guild.name}
          </option>
        ))}
      </select>
      <button type="submit">Add POV</button>
      {error && <p className="form-error">{error}</p>}
    </form>
  )
}
