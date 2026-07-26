import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { captureTwitchToken } from './twitch/auth'
import { completeWclLogin } from './wcl/pkce'

/**
 * Both OAuth callbacks are settled before React mounts.
 *
 * Twitch's implicit grant returns its token in the URL *fragment*, which is
 * also where this app's router lives — left alone it would look like a garbage
 * route and leave a token in the address bar. Warcraft Logs' PKCE code arrives
 * as a query parameter, so it doesn't collide, but it still has to be exchanged
 * and cleared so a refresh can't replay a spent code.
 *
 * Either handler redirects when it fires, so rendering is skipped in that case.
 */
async function start() {
  if (captureTwitchToken()) return
  if (await completeWclLogin()) return

  const container = document.getElementById('root')
  if (!container) throw new Error('Missing #root element')

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
