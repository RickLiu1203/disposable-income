import { cx } from "../lib/cx"

interface ToggleProps {
  options: readonly [string, string]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function Toggle({ options, value, onChange, className }: ToggleProps) {
  return (
    <div
      className={cx(
        "inline-flex gap-0.5 rounded-lg bg-neutral-100 p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cx(
            "rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors",
            option === value
              ? "bg-primary-600 text-white"
              : "text-neutral-500 hover:text-neutral-700",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}
