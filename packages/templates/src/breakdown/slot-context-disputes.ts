// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The disputed cuts the Analyst judges, one at a time (LRN1-CTX, SPEC "Writing the slots a page at a time"):
 * templates.breakdown hands out the first, and each templates.judgeCut stores a verdict and hands out the next. Each
 * verdict is saved progress, so the agent shows the looks that led to it as one line and the prompt stays the same
 * size however many cuts are disputed. The JUDGED_DISPUTES nearest the start are judged; the rest follow the rule
 * (`ruleKeeps`), as a cut nobody judged always has.
 */
import { join } from 'node:path';
import type { CutVerdict } from './build-template';
import type { BreakdownDraft } from './draft';

/** Disputed cuts the Analyst judges, nearest the start first. */
export const JUDGED_DISPUTES = 20;

/** A disputed cut as the model is shown it: its frames before and after, as absolute paths. */
interface DisputeView {
  readonly at: number;
  readonly method: BreakdownDraft['disputes'][number]['method'];
  readonly transition: string | null;
  readonly ruleKeeps: boolean;
  readonly before: string;
  readonly after: string;
}

/** The disputes to judge, nearest the start first. */
export function disputesToJudge(draft: BreakdownDraft): BreakdownDraft['disputes'] {
  return [...draft.disputes].sort((a, b) => a.frame - b.frame).slice(0, JUDGED_DISPUTES);
}

/** The dispute with its frames' paths in the experiment folder. */
export function disputeView(dispute: BreakdownDraft['disputes'][number], dir: string): DisputeView {
  return {
    at: dispute.frame,
    method: dispute.method,
    transition: dispute.transition?.kind ?? null,
    ruleKeeps: dispute.ruleKeeps,
    before: join(dir, dispute.before),
    after: join(dir, dispute.after),
  };
}

/** Where judging stands: how many of the disputes to judge have a verdict, and the next one without. */
export function judging(draft: BreakdownDraft, verdicts: readonly CutVerdict[], dir: string) {
  const toJudge = disputesToJudge(draft);
  const open = toJudge.filter((dispute) => !verdicts.some((verdict) => verdict.at === dispute.frame));
  const next = open[0];
  return {
    judged: toJudge.length - open.length,
    toJudge: toJudge.length,
    next: next ? disputeView(next, dir) : null,
  };
}
