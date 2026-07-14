import type { HTMLAttributes, ReactNode } from "react"
import { cx } from "../lib/cx"

interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  logo: ReactNode
  title: ReactNode
  subtitle: ReactNode
}

export function ListRow({ logo, title, subtitle, className, ...props }: ListRowProps) {
  return (
    <div
      className={cx(
        "flex items-center gap-2.5 rounded-md border-b border-neutral-100 px-1.5 py-2.5 last:border-b-0 hover:bg-neutral-50",
        className,
      )}
      {...props}
    >
      {logo}
      <div className="flex min-w-0 flex-col gap-px">
        <div className="text-sm font-medium text-neutral-900">{title}</div>
        <div className="text-xs tabular-nums text-neutral-500">{subtitle}</div>
      </div>
    </div>
  )
}
