import { useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  /** What pressing the confirm button will do to what is already there. */
  note: string
  confirmLabel: string
  error?: string
  onConfirm(text: string): void
  onClose(): void
}

/**
 * A box to paste into.
 *
 * Deliberately a textarea rather than reading the clipboard directly:
 * `navigator.clipboard.readText()` prompts for a scary-sounding permission in
 * Chrome and is not available to pages at all in Firefox. Pasting is a gesture
 * every browser already understands, and it lets the text be checked before it
 * replaces anything.
 */
export function PasteDialog({
  title,
  note,
  confirmLabel,
  error,
  onConfirm,
  onClose,
}: Props) {
  const [text, setText] = useState('')
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    areaRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>

        <textarea
          ref={areaRef}
          className="paste-area"
          rows={8}
          value={text}
          aria-label={title}
          placeholder="Paste here"
          onChange={(e) => setText(e.target.value)}
        />

        {error && <p className="warn-note">{error}</p>}

        <div className="modal-actions">
          <button className="primary" disabled={!text.trim()} onClick={() => onConfirm(text)}>
            {confirmLabel}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>

        <p className="dim">{note}</p>
      </div>
    </div>
  )
}
