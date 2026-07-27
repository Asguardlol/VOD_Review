import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { captureTwitchToken } from './twitch/auth'
import { completeWclLogin } from './wcl/pkce'

/**
 * Both OAuth callbacks are settled before React mounts, and they differ in a
 * way that matters.
 *
 * Twitch's implicit grant returns its token in the URL *fragment*, which is
 * also where this app's router lives — left alone it looks like a garbage route
 * and strands a token in the address bar. It is fixed up in place, without a
 * navigation, so rendering must continue normally afterwards.
 *
 * Warcraft Logs' PKCE code arrives as a query parameter. Clearing that is a
 * real navigation, so this document is about to be replaced and there is no
 * point mounting anything.
 */
async function start() {
  captureTwitchToken()
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
