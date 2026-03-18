/**
 * HeaderItemFrame — view-only wrapper for a header item.
 * Simple flex child that enables pointer events for the rendered item.
 */

import type { ReactNode } from "react";

interface HeaderItemFrameProps {
  children: ReactNode;
}

export function HeaderItemFrame({ children }: HeaderItemFrameProps) {
  return (
    <div className="flex items-center pointer-events-auto">
      {children}
    </div>
  );
}
