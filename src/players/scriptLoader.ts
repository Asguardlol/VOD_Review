/**
 * Loading the two third-party player SDKs.
 *
 * Both are external scripts, which is the one place this app is not
 * self-contained (noted in CLAUDE.md). Each is fetched at most once and cached
 * as a promise, because a review with fifteen POVs would otherwise inject
 * fifteen copies of the same script.
 */

const loaded = new Map<string, Promise<void>>()

function injectScript(src: string): Promise<void> {
  const existing = loaded.get(src)
  if (existing) return existing

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever —
      // this is usually a blocked network or an ad blocker, both recoverable.
      loaded.delete(src)
      reject(new Error(`Failed to load ${src}`))
    }
    document.head.appendChild(script)
  })

  loaded.set(src, promise)
  return promise
}

/**
 * The YouTube IFrame API does not resolve on script load — it calls a global
 * `onYouTubeIframeAPIReady` when it is actually usable. Chaining onto any
 * existing handler keeps this safe if something else on the page also waits.
 */
export function loadYouTubeApi(): Promise<void> {
  const key = 'youtube-api-ready'
  const existing = loaded.get(key)
  if (existing) return existing

  const promise = new Promise<void>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve()
      return
    }
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve()
    }
    injectScript('https://www.youtube.com/iframe_api').catch(reject)
  })

  loaded.set(key, promise)
  return promise
}

export function loadTwitchApi(): Promise<void> {
  return injectScript('https://player.twitch.tv/js/embed/v1.js')
}
