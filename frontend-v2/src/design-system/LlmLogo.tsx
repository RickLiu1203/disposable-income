import { cx } from "../lib/cx"

type LlmLogoSize = "sm" | "md"

interface LlmLogoProps {
  label: string
  size?: LlmLogoSize
  className?: string
}

const sizeClasses: Record<LlmLogoSize, string> = {
  sm: "h-5 w-5 rounded text-[9px]",
  md: "h-8 w-8 rounded-md text-xs",
}

export function LlmLogo({ label, size = "md", className }: LlmLogoProps) {
  return (
    <div
      className={cx(
        "flex shrink-0 items-center justify-center bg-primary-100 font-bold text-primary-700",
        sizeClasses[size],
        className,
      )}
    >
      {label}
    </div>
  )
}
