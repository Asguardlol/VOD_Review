import { useState } from 'react'
import { getWclMode } from '../wcl/config'
import { PastedTokenSource } from '../wcl/tokenSources'

/**
 * Warcraft Logs credential entry.
 *
 * Separate from the pull browser because it is setup, not part of the review
 * loop — once a token is saved this collapses to a single line and stays out of
 * the way.
 */
export function WclTokenPanel() {
  const mode = getWclMode()
  const [token, setToken] = useState('')
  const [hasToken, setHasToken] = useState(() => PastedTokenSource.has())

  if (mode !== 'token') return null

  if (hasToken) {
    return (
      <p className="sidebar-empty dim">
        Warcraft Logs connected.{' '}
        <button
          className="link-button"
          onClick={() => {
            PastedTokenSource.clear()
            setHasToken(false)
          }}
        >
          Clear token
        </button>
      </p>
    )
  }

  return (
    <form
      className="token-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!token.trim()) return
        PastedTokenSource.set(token)
        setToken('')
        setHasToken(true)
      }}
    >
      <p className="dim">
        Paste a Warcraft Logs bearer token. Stored in this browser only, and sent
        nowhere except warcraftlogs.com.
      </p>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Bearer token"
        aria-label="Warcraft Logs bearer token"
      />
      <button type="submit">Save token</button>
    </form>
  )
}
