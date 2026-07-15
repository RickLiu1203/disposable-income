import type { ReactNode } from "react";

interface PanelLayoutProps {
  left?: ReactNode;
  right?: ReactNode;
  rightTitle?: ReactNode;
  /** Renders full-width across the left column (not confined to the
   * centered w-2/3 inner content below it), for page chrome like a match
   * header that wants more room to breathe than the body copy. */
  header?: ReactNode;
}

export function PanelLayout({ left, right, rightTitle, header }: PanelLayoutProps) {
  return (
    <div className="flex h-screen bg-white overflow-hidden">
      <div className="flex w-2/3 flex-col bg-white overflow-y-auto overscroll-contain">
        {header}
        <div className="flex flex-1 justify-center">
          <div className="w-2/3">{left}</div>
        </div>
      </div>
      <div className="w-1/3 border-l border-neutral-200 bg-secondary-50 p-8 overflow-y-auto overscroll-contain">
        {rightTitle && (
          <h1 className="mb-6 text-lg font-semibold tracking-tight text-neutral-900">
            {rightTitle}
          </h1>
        )}
        {right}
      </div>
    </div>
  );
}
