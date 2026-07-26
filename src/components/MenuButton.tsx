import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuAction {
  label: string
  onSelect(): void
  /** Renders red and, when `confirm` is set, asks first. */
  destructive?: boolean
  /** Confirmation prompt text. Only used for destructive actions. */
  confirm?: string
  disabled?: boolean
}

interface Props {
  actions: MenuAction[]
  label?: ReactNode
  title?: string
}

/**
 * A "…" overflow menu.
 *
 * Destructive actions live in here rather than as bare buttons so deleting a POV
 * or a whole review takes a deliberate two steps instead of one stray click —
 * particularly important next to a video tile the user is already clicking on.
 */
export function MenuButton({ actions, label = '⋯', title = 'More actions' }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape — a menu that traps focus is worse than
  // no menu.
  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="menu-root" ref={rootRef}>
      <button
        className="icon-button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>

      {open && (
        <div className="menu-popover" role="menu">
          {actions.map((action) => (
            <button
              key={action.label}
              role="menuitem"
              disabled={action.disabled}
              className={action.destructive ? 'destructive' : undefined}
              onClick={() => {
                if (action.confirm && !window.confirm(action.confirm)) return
                action.onSelect()
                setOpen(false)
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
