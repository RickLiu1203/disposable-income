import { useEffect } from "react"
import type { MouseEvent, ReactNode } from "react"
import { cx } from "../lib/cx"

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      onClick={handleBackdropClick}
    >
      <div
        className={cx(
          "flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.05)]",
          className,
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="text-lg font-semibold tracking-tight text-neutral-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-lg leading-none text-neutral-400 hover:text-neutral-700"
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
