import type { HTMLAttributes } from "react"
import { cx } from "../lib/cx"

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-md bg-neutral-100 after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer after:bg-gradient-to-r after:from-transparent after:via-white/70 after:to-transparent motion-reduce:after:animate-none",
        className,
      )}
      {...props}
    />
  )
}
