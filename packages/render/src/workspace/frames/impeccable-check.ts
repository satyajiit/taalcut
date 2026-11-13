// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Impeccable visual craft & anti-slop check for `workspace.frames` (WP-HFW-3D-CDP):
 * enforces deterministic motion-design craft rules on rendered stills:
 * 1. Density ceiling: at most 6 lines of copy per overlay frame (no wall-of-text slop cards).
 * 2. Typographic scale contrast: when distinct text roles (headline vs subhead/label) appear
 *    together, their scale ratio must be decisive (>= 1.18x), never in the muddied (1.04x–1.17x) band.
 * 3. Card breathing room: text inside a painted card backdrop must keep >= 8 px inner padding.
 */
import type { CompositionGateCheck } from '@taalcut/core';
import { lineCount, typeOf, type ProbedContent } from './content-probe';

export const IMPECCABLE_CRAFT_THRESHOLDS = {
  maxLinesPerFrame: 6,
  minHierarchyRatio: 1.18,
  sameSizeToleranceRatio: 1.04,
  minCardPaddingPx: 8,
} as const;

const at = (seconds: number | undefined) => `at ${(seconds ?? 0).toFixed(2)} s`;

interface LineGroup {
  readonly top: number;
  readonly sizePx: number;
  readonly family: string;
  readonly colour: string | null;
}

function groupLines(content: ProbedContent): LineGroup[] {
  const runs = [...content.texts].sort((a, b) => a.top - b.top);
  const groups: LineGroup[] = [];
  for (const run of runs) {
    const prev = groups[groups.length - 1];
    if (!prev || run.top - prev.top > Math.min(prev.sizePx, run.sizePx) / 2) {
      groups.push({
        top: run.top,
        sizePx: run.sizePx,
        family: run.family,
        colour: run.colour,
      });
    }
  }
  return groups;
}

export function impeccableFrameCheck(
  contents: readonly (ProbedContent | null)[],
  seconds: readonly number[],
): CompositionGateCheck {
  const { maxLinesPerFrame, minHierarchyRatio, sameSizeToleranceRatio, minCardPaddingPx } =
    IMPECCABLE_CRAFT_THRESHOLDS;

  let anyText = false;

  for (const [index, content] of contents.entries()) {
    if (!content || content.texts.length === 0) continue;
    anyText = true;
    const when = at(seconds[index]);

    // 1. Density ceiling: prevent wall-of-text slop cards.
    const lines = lineCount(content);
    if (lines > maxLinesPerFrame) {
      return {
        id: 'impeccableCraft',
        status: 'fail',
        detail: `${lines} text lines drawn ${when} (max ${maxLinesPerFrame}). Cut copy density or split across beats so the frame reads at a glance.`,
      };
    }

    // 2. Typographic hierarchy contrast between distinct roles (different family, colour, or settled lines).
    const grouped = groupLines(content);
    if (grouped.length >= 2) {
      const sizes = grouped.map((g) => g.sizePx);
      const maxSize = Math.max(...sizes);
      const minSize = Math.min(...sizes);
      const ratio = minSize > 0 ? maxSize / minSize : 1;
      const distinctRoles = grouped.some(
        (g) => g.family !== grouped[0]?.family || g.colour !== grouped[0]?.colour,
      );
      if (ratio > sameSizeToleranceRatio && ratio < minHierarchyRatio && distinctRoles) {
        return {
          id: 'impeccableCraft',
          status: 'fail',
          detail: `indecisive type hierarchy (${maxSize.toFixed(0)} px vs ${minSize.toFixed(0)} px, ratio ${ratio.toFixed(2)}× < ${minHierarchyRatio}×) ${when}. Make headline and secondary text clearly distinct (≥ ${minHierarchyRatio}×) or identical.`,
        };
      }
    }

    // 3. Card breathing room: text on a painted backdrop needs inner padding.
    const hasBackdrop = content.texts.some((t) => t.backdrop !== null);
    const measuredType = typeOf(content);
    if (hasBackdrop && measuredType) {
      const { top, right, bottom, left } = measuredType.padding;
      const minPad = Math.min(top, right, bottom, left);
      if (minPad >= 0 && minPad < minCardPaddingPx) {
        return {
          id: 'impeccableCraft',
          status: 'fail',
          detail: `cramped card padding (${minPad.toFixed(1)} px < ${minCardPaddingPx} px) ${when}. Give painted cards breathing room (at least 16–24 px padding).`,
        };
      }
    }
  }

  if (!anyText) {
    return {
      id: 'impeccableCraft',
      status: 'skipped',
      detail: 'no words were drawn in the stills',
    };
  }

  return { id: 'impeccableCraft', status: 'pass' };
}
