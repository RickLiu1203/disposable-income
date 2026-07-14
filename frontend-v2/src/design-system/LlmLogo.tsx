import { cx } from "../lib/cx"

type LlmLogoSize = "sm" | "md"

interface LlmLogoProps {
  label: string
  /** Optional brand icon image src, rendered in place of the initials label. */
  icon?: string
  size?: LlmLogoSize
  className?: string
}

const sizeClasses: Record<LlmLogoSize, string> = {
  sm: "h-5 w-5 rounded text-[9px]",
  md: "h-8 w-8 rounded-md text-xs",
}

const iconPadding: Record<LlmLogoSize, string> = {
  sm: "p-1",
  md: "p-1.5",
}

export function LlmLogo({ label, icon, size = "md", className }: LlmLogoProps) {
  return (
    <div
      className={cx(
        "flex shrink-0 items-center justify-center bg-primary-100 font-bold text-primary-700",
        sizeClasses[size],
        className,
      )}
    >
      {icon ? (
        <img
          src={icon}
          alt={label}
          className={cx("h-full w-full object-contain", iconPadding[size])}
        />
      ) : (
        label
      )}
    </div>
  )
}
