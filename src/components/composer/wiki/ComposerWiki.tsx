/**
 * Composer Wiki — SIP & HTTP reference docs.
 * Phase 1 stub: delegates to the existing CrafterWiki.
 * Full migration in Phase 2b.
 */

import { lazy, Suspense } from "react";

const CrafterWiki = lazy(() =>
  import("@/components/request-crafter/CrafterWiki").then((m) => ({
    default: m.CrafterWiki,
  }))
);

export function ComposerWiki() {
  return (
    <Suspense fallback={<div className="flex-1 min-h-0" aria-hidden />}>
      <CrafterWiki />
    </Suspense>
  );
}
