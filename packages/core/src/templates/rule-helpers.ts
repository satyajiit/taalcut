// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Small helpers the Template and Timeline invariant checks share. Each check
 * reports an issue with its path, so a bad document names the exact field.
 */
import type { z } from 'zod';
import { FrameRate } from '../time/frame-rate';
import { RationalTime } from '../time/rational-time';

export type Path = readonly (string | number)[];

export interface RuleContext {
  issue(path: Path, message: string): void;
  /** Reports a time not at `rate`; true when it is. */
  atRate(time: RationalTime, rate: FrameRate, path: Path): boolean;
  /** Reports duplicates among ids; `at` gives each id's path. */
  unique(ids: readonly string[], at: (index: number) => Path, what: string): void;
}

export function ruleContext(ctx: z.RefinementCtx): RuleContext {
  const issue = (path: Path, message: string) => ctx.addIssue({ code: 'custom', message, path: [...path] });
  return {
    issue,
    atRate(time, rate, path) {
      if (FrameRate.equals(time.rate, rate)) return true;
      issue(path, `Expected a time at ${rate.num}/${rate.den}`);
      return false;
    },
    unique(ids, at, what) {
      const seen = new Set<string>();
      ids.forEach((id, index) => {
        if (seen.has(id)) issue(at(index), `Duplicate ${what} id`);
        seen.add(id);
      });
    },
  };
}

/** a + b, or a's rate when both share it (the common case). */
export const plus = (a: RationalTime, b: RationalTime): RationalTime => RationalTime.add(a, b);
export const lessThan = (a: RationalTime, b: RationalTime): boolean => RationalTime.compare(a, b) < 0;
export const atMost = (a: RationalTime, b: RationalTime): boolean => RationalTime.compare(a, b) <= 0;
