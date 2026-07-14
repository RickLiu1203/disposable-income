import type { InputHTMLAttributes } from "react"
import { cx } from "../lib/cx"

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full border-0 border-b border-neutral-300 bg-transparent px-0.5 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-accent-600 focus:outline-none",
        className,
      )}
      {...props}
    />
  )
}
