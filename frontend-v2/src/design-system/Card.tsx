import type { HTMLAttributes } from "react"
import { cx } from "../lib/cx"

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.05)]",
        className,
      )}
      {...props}
    />
  )
}
