import { useEffect, useRef, useState } from 'react'
import { URL_LENGTH_WARN_THRESHOLD } from '../core/share'

interface Props {
  url: string
  onDownloadJson(): void
  onClose(): void
}

/**
 * The share link, shown rather than silently copied.
 *
 * There is no server behind any of this: the session is compressed into the
 * link itself, so the link *is* the data. That has a consequence worth putting
 * in front of the user rather than in a comment — past a few thousand
 * characters some chat clients cut the URL, and the recipient gets a link that
 * cannot be decoded. Hence the length warning and the JSON escape hatch.
 */
export function ShareDialog({ url, onDownloadJson, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const tooLong = url.length > URL_LENGTH_WARN_THRESHOLD

  // Selected on open, so Ctrl+C works even when the clipboard API does not.
  useEffect(() => {
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = () => {
    inputRef.current?.select()
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true)
        setCopyFailed(false)
      },
      // Denied permission, or an insecure context. The link is on screen and
      // selected either way, so this is a nudge rather than a failure.
      () => setCopyFailed(true),
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Share this session"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Share this session</h2>

        <input ref={inputRef} className="share-url" readOnly value={url} />

        <div className="modal-actions">
          <button className="primary" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <button onClick={onDownloadJson}>Download JSON</button>
          <button onClick={onClose}>Close</button>
        </div>

        {copyFailed && (
          <p className="warn-note">
            Your browser would not let the page write to the clipboard. The link is
            selected above — copy it with Ctrl+C.
          </p>
        )}

        {tooLong && (
          <p className="warn-note">
            This link is {url.length.toLocaleString()} characters. Discord and some
            other clients truncate long URLs, and a cut link cannot be opened — send
            the JSON file instead if it does not survive the trip.
          </p>
        )}

        <p className="dim">
          The whole session travels in the link: the report, everyone's channels,
          your guilds, the broadcast delays and every note on this pull. Nothing is
          stored on a server — there isn't one.
        </p>
        <p className="dim">
          Whoever opens it signs in with their own Warcraft Logs and Twitch to pull
          the fights and find the VODs. If they already have this session, they are
          asked before anything of theirs is replaced.
        </p>
      </div>
    </div>
  )
}
