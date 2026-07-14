import type { ButtonHTMLAttributes } from "react"
import { cx } from "../lib/cx"

type ButtonVariant = "primary" | "secondary"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent-600 text-white hover:bg-accent-700",
  secondary:
    "bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-50",
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-colors",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  )
}
