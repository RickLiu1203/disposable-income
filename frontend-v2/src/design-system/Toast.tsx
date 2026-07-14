import type { ReactNode } from "react"
import { cx } from "../lib/cx"

type ToastVariant = "success" | "error"

interface ToastProps {
  variant: ToastVariant
  title: string
  message: ReactNode
  onDismiss?: () => void
  className?: string
}

const variantClasses: Record<ToastVariant, string> = {
  success: "bg-success-50 text-success-700",
  error: "bg-error-50 text-error-700",
}

export function Toast({
  variant,
  title,
  message,
  onDismiss,
  className,
}: ToastProps) {
  return (
    <div
      className={cx(
        "flex w-72 items-start gap-2.5 rounded-xl p-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.05)]",
        variantClasses[variant],
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs opacity-85">{message}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100"
        >
          &times;
        </button>
      )}
    </div>
  )
}
