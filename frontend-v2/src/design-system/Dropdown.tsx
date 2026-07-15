import { useEffect, useRef, useState } from "react"
import { cx } from "../lib/cx"

interface DropdownOption {
  label: string
  value: string
}

interface DropdownProps {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function Dropdown({ options, value, onChange, className }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  return (
    <div ref={ref} className={cx("relative w-56", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((isOpen) => !isOpen)}
        className="flex w-full items-center justify-between gap-2.5 rounded-md border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-900"
      >
        <span>{selected?.label ?? "Select"}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cx(
            "h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform",
            open && "rotate-180",
          )}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute top-[calc(100%+6px)] left-0 z-20 min-w-full rounded-lg bg-white p-1.5 shadow-[0_1px_3px_rgba(15,23,42,0.08),0_8px_24px_rgba(15,23,42,0.08)]"
        >
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <div
                key={option.value}
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cx(
                  "flex cursor-pointer items-center justify-between gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-neutral-50",
                  isSelected ? "font-semibold text-neutral-900" : "text-neutral-700",
                )}
              >
                <span>{option.label}</span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cx(
                    "h-3.5 w-3.5 shrink-0 text-secondary-600",
                    isSelected ? "visible" : "invisible",
                  )}
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
