// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: gap fix view (P3-B8) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · every gap with its fixes, one after the other on the surface it sits on (the card's panel,
 *   the editor's popover): no boxes, a hairline between gaps; the gapFix card and "Fix this gap" both render it
 * states: open gaps (their rows) · pending (a row's own) · settled gaps fold to one line · all settled (the caller's
 *   success line) · disabled (the answer went: Choose is read only)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { TimelineItemId } from '@taalcut/core';
import { useCallback, useMemo, useState } from 'react';
import { GapItem } from './gap-item';
import type { GapFixChoice, GapFixHandlers, GapFixItem } from './gap-types';

export interface GapFixViewProps extends GapFixHandlers {
  gaps: readonly GapFixItem[];
  /** A fix went through here (the view's caller folds the gap with useSettledGaps). */
  onSettled: (gapId: TimelineItemId, outcome: 'filled' | 'dropped', via: GapFixItem['via']) => void;
  /** While the agent asks: the chosen fix per gap. */
  choice?: GapFixChoice;
  /** h3 in the editor's popover, h4 under a card's title. */
  level?: 3 | 4;
}

type Settled = ReadonlyMap<TimelineItemId, Pick<GapFixItem, 'outcome' | 'via'>>;

/** The gaps with what was fixed here since they came (a card's snapshot doesn't move until the agent's next). */
export function useSettledGaps(gaps: readonly GapFixItem[]) {
  const [settled, setSettled] = useState<Settled>(new Map());
  const settle = useCallback(
    (gapId: TimelineItemId, outcome: 'filled' | 'dropped', via: GapFixItem['via']) =>
      setSettled((was) => new Map(was).set(gapId, via ? { outcome, via } : { outcome })),
    [],
  );
  const shown = useMemo(
    () =>
      gaps.map((gap): GapFixItem => {
        // What was fixed here wins over "already fixed": the live timeline moved on because of it.
        const here = gap.outcome === 'open' || gap.outcome === 'gone' ? settled.get(gap.gapId) : undefined;
        if (!here) return gap;
        const { via: _via, ...rest } = gap;
        return { ...rest, outcome: here.outcome, ...(here.via ? { via: here.via } : {}) };
      }),
    [gaps, settled],
  );
  const fixed = shown.filter((gap) => gap.outcome !== 'open').length;
  return { gaps: shown, settle, fixed, total: shown.length };
}

export function GapFixView({ gaps, onSettled, choice, level = 4, ...handlers }: GapFixViewProps) {
  const { t } = useLingui();
  return (
    <ul
      data-slot="gap-fix-view"
      aria-label={t`Gaps`}
      className="m-0 flex list-none flex-col gap-4 p-0 [&>li+li]:border-t [&>li+li]:border-rule [&>li+li]:pt-4"
    >
      {gaps.map((gap) => (
        <GapItem
          key={gap.gapId}
          gap={gap}
          handlers={handlers}
          level={level}
          onSettled={(outcome, via) => onSettled(gap.gapId, outcome, via)}
          {...(choice ? { choice } : {})}
        />
      ))}
    </ul>
  );
}
