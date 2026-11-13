// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Reel, Slot } from '#content/schema';
import { roleRuns, type RoleRun } from './strip-layout';

/**
 * The pick list's rows (pure; test/unit/demo-picks.test.ts). The app's cast grid shows, per slot, what it wants, the
 * pick, how sure the AI is (High, Medium or Low beside a three-step meter) and up to three other shots. It never gives
 * a reason. The list groups the slots by the strip's own runs, so seven slots that want the same thing are one row.
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export const CONFIDENCE_WORD: Readonly<Record<ConfidenceLevel, string>> = { high: 'High', medium: 'Medium', low: 'Low' };
export const CONFIDENCE_STEPS: Readonly<Record<ConfidenceLevel, number>> = { high: 3, medium: 2, low: 1 };
const ORDER: readonly ConfidenceLevel[] = ['high', 'medium', 'low'];

/** The sample's stand-in for how sure the AI is: Medium where the breakdown wasn't sure of the cut, High elsewhere. */
export function confidenceOf(slot: Pick<Slot, 'uncertainCut'>): ConfidenceLevel {
  return slot.uncertainCut ? 'medium' : 'high';
}

export interface PickGroup extends RoleRun {
  /** What the run's slots want, each different line once. */
  readonly needs: readonly string[];
  /** How many of its picks sit at each level, surest first; levels with none are left out. */
  readonly levels: readonly { readonly level: ConfidenceLevel; readonly count: number }[];
  /** The most other shots any of its slots offers. */
  readonly alternates: number;
}

export function pickGroups(reel: Pick<Reel, 'slots'>): PickGroup[] {
  return roleRuns(reel.slots).map((run) => {
    const slots = reel.slots.slice(run.first, run.last + 1);
    const counts = new Map<ConfidenceLevel, number>();
    for (const slot of slots) counts.set(confidenceOf(slot), (counts.get(confidenceOf(slot)) ?? 0) + 1);
    return {
      ...run,
      needs: [...new Set(slots.map((s) => s.needs).filter(Boolean))],
      levels: ORDER.flatMap((level) => (counts.has(level) ? [{ level, count: counts.get(level) ?? 0 }] : [])),
      alternates: Math.max(0, ...slots.map((s) => s.pick.alternates)),
    };
  });
}

/** The group that holds slot `index` (the last one past the end). */
export function groupOfSlot(groups: readonly Pick<PickGroup, 'first' | 'last'>[], index: number): number {
  const i = groups.findIndex((g) => index >= g.first && index <= g.last);
  return i === -1 ? Math.max(groups.length - 1, 0) : i;
}

/** Up to this many groups show at once; more than that, and a window of `WINDOW` rows follows the playhead. */
export const MAX_ROWS = 5;
export const WINDOW = 4;

/** The rows to show, [start, end): every group when they fit, else a window that keeps `focus` in view. */
export function pickWindow(count: number, focus: number, max = MAX_ROWS, size = WINDOW): readonly [number, number] {
  if (count <= max) return [0, count];
  const start = Math.min(Math.max(focus - 1, 0), count - size);
  return [start, start + size];
}

/** "3 other shots", or "3 other shots each" for a run of several. */
export function otherShots(group: Pick<PickGroup, 'alternates' | 'count'>): string {
  const n = group.alternates;
  const shots = `${n} other ${n === 1 ? 'shot' : 'shots'}`;
  return group.count > 1 ? `${shots} each` : shots;
}
