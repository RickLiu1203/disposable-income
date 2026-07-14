import type { HTMLAttributes } from "react"
import { cx } from "../lib/cx"

type ChipVariant = "neutral" | "primary" | "secondary" | "success" | "error"

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant
}

const variantClasses: Record<ChipVariant, string> = {
  neutral: "bg-neutral-100 text-neutral-600",
  primary: "bg-primary-50 text-primary-700",
  secondary: "bg-secondary-50 text-secondary-700",
  success: "bg-success-50 text-success-700",
  error: "bg-error-50 text-error-700",
}

export function Chip({ variant = "neutral", className, ...props }: ChipProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  )
}
