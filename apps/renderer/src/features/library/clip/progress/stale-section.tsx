// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: a part of the clip page Analyse again is redoing (LIB1-PROG) · mode: Operate · system: DESIGN.md v0.7
 * the part stays as it was (what Taalcut found last time is still worth reading) and says, quietly, that it is from
 *   the last analysis and being redone: one type-meta line in ink-2 above it, and aria-busy. Words, not a wash or
 *   a dim: a dimmed transcript fell under the reading floors, and colour is never the only sign. Gone when the new
 *   result lands
 * states: as it was · stale (the line, busy) · interactive states are the part's own
 * contrast: the line ink-2 ≥ 7:1 on canvas, both themes · motion: none
 */
import { useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';

export function StaleSection({ stale, children }: { stale: boolean; children: ReactNode }) {
  const { t } = useLingui();
  if (!stale) return <>{children}</>;
  return (
    <div data-slot="clip-stale" aria-busy className="flex flex-col gap-2">
      <p className="m-0 type-meta text-ink-2">{t`From the last analysis. Taalcut is redoing it.`}</p>
      {children}
    </div>
  );
}
