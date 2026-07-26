import { useMemo, useState } from 'react'
import type { VodDeath, VodFight } from '../core/types'
import type { WclClient, WclReport } from '../wcl/client'
import { getWclMode, parseReportCode } from '../wcl/config'
import { PastedTokenSource } from '../wcl/tokenSources'
import { formatTime } from '../core/format'

interface Props {
  client: WclClient | undefined
  fight: VodFight | undefined
  onAttach(fight: VodFight, deaths: VodDeath[]): void
  onDetach(): void
}

/**
 * Browse a Warcraft Logs report and attach one pull to the review.
 *
 * Fights are grouped by encounter and listed with their time and duration,
 * which is how you actually find a pull — you remember "the third Mythic
 * attempt", not a fight id.
 */
export function AttachLogPanel({ client, fight, onAttach, onDetach }: Props) {
  const mode = getWclMode()
  const [input, setInput] = useState('')
  const [report, setReport] = useState<WclReport | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [token, setToken] = useState('')
  const [hasToken, setHasToken] = useState(() => PastedTokenSource.has())

  const byEncounter = useMemo(() => {
    const groups = new Map<number, { name: string; fights: VodFight[] }>()
    for (const f of report?.fights ?? []) {
      const group = groups.get(f.encounterId) ?? { name: f.encounterName, fights: [] }
      group.fights.push(f)
      groups.set(f.encounterId, group)
    }
    return [...groups.values()]
  }, [report])

  if (mode === 'disabled') {
    return (
      <details className="log-panel">
        <summary>Warcraft Logs — turned off</summary>
        <div className="log-panel-body">
          <p>
            Death lines on the timeline and log browsing need the Warcraft Logs
            API, and this build was made with{' '}
            <code>VITE_WCL_MODE=disabled</code>.
          </p>
          <p>
            Rebuild without it to paste your own bearer token, or set{' '}
            <code>VITE_WCL_MODE=proxy</code> with <code>VITE_WCL_ENDPOINT</code> to
            go through a backend that holds the client secret. Both run the same
            client code, so it is a build variable rather than a change to the app.
          </p>
          <p className="dim">
            Everything else — POVs, syncing, markers, sharing — works without it.
          </p>
        </div>
      </details>
    )
  }

  const load = async () => {
    if (!client) return
    // Don't spend a round trip to be told what we already know.
    if (mode === 'token' && !hasToken) {
      setError('Save a Warcraft Logs bearer token first — the box above.')
      return
    }
    const code = parseReportCode(input)
    if (!code) {
      setError('That does not look like a Warcraft Logs report link or code.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      setReport(await client.listFights(code))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load that report.')
    } finally {
      setBusy(false)
    }
  }

  const attach = async (selected: VodFight) => {
    if (!client) return
    setBusy(true)
    setError(undefined)
    try {
      // Deaths are the point of attaching a log, but a fight that loads without
      // them is still useful — it bounds the timeline. So a death fetch failure
      // degrades rather than aborting the attach.
      let deaths: VodDeath[] = []
      try {
        deaths = await client.listDeaths(selected)
      } catch (caught) {
        setError(
          `Attached the pull, but could not load deaths: ${
            caught instanceof Error ? caught.message : 'unknown error'
          }`,
        )
      }
      onAttach(selected, deaths)
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="log-panel" open={!fight}>
      <summary>
        {fight
          ? `Log: ${fight.encounterName}${
              fight.difficultyName ? ` (${fight.difficultyName})` : ''
            } — pull ${fight.pullNumber ?? '?'}`
          : 'Attach a Warcraft Logs pull'}
      </summary>

      <div className="log-panel-body">
        {mode === 'token' && !hasToken && (
          <div className="token-form">
            <p>
              Paste a Warcraft Logs bearer token. It is stored in this browser's{' '}
              <code>localStorage</code> and never sent anywhere except
              warcraftlogs.com.
            </p>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Bearer token"
              aria-label="Warcraft Logs bearer token"
            />
            <button
              onClick={() => {
                if (!token.trim()) return
                PastedTokenSource.set(token)
                setToken('')
                setHasToken(true)
              }}
            >
              Save token
            </button>
          </div>
        )}

        {mode === 'token' && hasToken && (
          <p className="dim">
            Token saved.{' '}
            <button
              className="link-button"
              onClick={() => {
                PastedTokenSource.clear()
                setHasToken(false)
              }}
            >
              Clear it
            </button>
          </p>
        )}

        {fight ? (
          <div className="attached-fight">
            <p>
              {fight.encounterName}
              {fight.difficultyName ? ` · ${fight.difficultyName}` : ''} · pull{' '}
              {fight.pullNumber ?? '?'} · {formatTime(fight.durationMs)} ·{' '}
              {fight.kill
                ? 'Kill'
                : `Wipe${
                    fight.bossPercentage != null ? ` at ${fight.bossPercentage}%` : ''
                  }`}
            </p>
            <p className="dim">
              Timeline zero is pull start, so sync each POV to the pull.
            </p>
            <button onClick={onDetach}>Detach log</button>
          </div>
        ) : (
          <>
            <div className="report-form">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Warcraft Logs report link or code"
                aria-label="Report link"
              />
              <button onClick={() => void load()} disabled={busy || !client}>
                {busy ? 'Loading…' : 'Load report'}
              </button>
            </div>

            {report && (
              <div className="fight-list">
                <h4>{report.title}</h4>
                {byEncounter.map((group) => (
                  <section key={group.name}>
                    <h5>{group.name}</h5>
                    <ul>
                      {group.fights.map((f) => (
                        <li key={f.fightId}>
                          <button onClick={() => void attach(f)} disabled={busy}>
                            <span>
                              Pull {f.pullNumber}
                              {f.difficultyName ? ` · ${f.difficultyName}` : ''}
                            </span>
                            <span className="dim">
                              {formatTime(f.durationMs)} ·{' '}
                              {f.kill
                                ? 'Kill'
                                : `Wipe${
                                    f.bossPercentage != null ? ` ${f.bossPercentage}%` : ''
                                  }`}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </>
        )}

        {error && <p className="form-error">{error}</p>}
      </div>
    </details>
  )
}
