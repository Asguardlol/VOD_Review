import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { captureTwitchToken } from './twitch/auth'

/**
 * Twitch returns its OAuth token in the URL fragment, which is also where this
 * app's router lives. Capture it before React mounts: the token is pulled out,
 * stored, and the previous route restored, so the router never sees
 * `#access_token=…` and the token never lingers in the address bar or history.
 */
if (!captureTwitchToken()) {
  const container = document.getElementById('root')
  if (!container) throw new Error('Missing #root element')

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
