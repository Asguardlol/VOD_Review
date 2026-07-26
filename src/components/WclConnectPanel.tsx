import { useState } from 'react'
import { beginWclLogin, clearWclToken, hasWclToken, isWclConfigured } from '../wcl/pkce'

/**
 * Warcraft Logs sign-in.
 *
 * One button, because PKCE means there is nothing for the user to paste or
 * safeguard. Signing in as themselves is also what lets private and guild
 * reports load, so this is worth surfacing rather than burying in settings.
 */
export function WclConnectPanel() {
  const [connected, setConnected] = useState(() => hasWclToken())

  if (!isWclConfigured()) {
    return (
      <p className="sidebar-empty dim">
        No Warcraft Logs Client ID in this build, so reports can't be loaded. Set{' '}
        <code>VITE_WCL_CLIENT_ID</code>.
      </p>
    )
  }

  if (connected) {
    return (
      <p className="sidebar-empty dim">
        Warcraft Logs connected.{' '}
        <button
          className="link-button"
          onClick={() => {
            clearWclToken()
            setConnected(false)
          }}
        >
          Sign out
        </button>
      </p>
    )
  }

  return (
    <div className="token-form">
      <p className="dim">
        Sign in to load reports. Private and guild logs work too, because you're
        authenticating as yourself.
      </p>
      <button className="primary" onClick={() => void beginWclLogin()}>
        Connect Warcraft Logs
      </button>
    </div>
  )
}
