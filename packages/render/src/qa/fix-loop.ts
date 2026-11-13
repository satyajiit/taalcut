// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fix loop (SPEC section 10, docs/qa-gate.md rule 5). Inside one render:
 * QA runs, the render process applies the `auto` fixes (re-normalise, remux,
 * re-encode, re-render) and runs the affected checks again on the same
 * render. Across renders: a re-export after command or agent fixes is the
 * next round, and there are never more than three.
 */
import {
  defineError,
  err,
  ok,
  QA_MAX_ROUNDS,
  type AsyncResult,
  type QaCheckId,
  type QaFix,
  type QaReport,
  type Result,
} from '@taalcut/core';
import { planQaFixes } from './fixes';
import { QA_CHECKS } from './result';

/** A fourth round: the fix loop is over and the user decides (SPEC section 13). */
export const QaRoundsExhausted = defineError<{ rounds: number }>('render.qa_rounds_exhausted');

/** The round of a render that supersedes one at `previousRound` (null: a first export). */
export function nextRound(previousRound: number | null, maxRounds: number = QA_MAX_ROUNDS): Result<number> {
  const round = (previousRound ?? 0) + 1;
  if (round > maxRounds) return err(QaRoundsExhausted({ rounds: maxRounds }));
  return ok(round);
}

export type AutoAction = Extract<QaFix, { kind: 'auto' }>['action'];

export interface FixLoopInput {
  /** Runs QA on the current file: everything, or only the listed checks merged into `previous`. */
  readonly runQa: (only?: readonly QaCheckId[], previous?: QaReport) => AsyncResult<QaReport>;
  /** Applies one auto fix to the render in its work folder; `checks` are the failing checks it is for. */
  readonly applyAuto: (action: AutoAction, checks: readonly QaCheckId[]) => AsyncResult<void>;
  /** 'checking' before each QA run, 'fixing' before each auto fix (the render's status). */
  readonly onStage?: (stage: 'checking' | 'fixing') => void;
  /** Auto-fix passes inside this render. Default 2: one fix, and one more if a re-render uncovers another. */
  readonly maxAutoPasses?: number;
}

const POST_RENDER = QA_CHECKS.filter((meta) => !meta.preflight).map((meta) => meta.id);
/** EAR1-A2: the checks one hearing of the render answers together (qa/modules/sound-listening.ts). */
const HEARD: readonly QaCheckId[] = ['soundOnCuts', 'soundClean', 'soundCritique'];

/**
 * EAR1-R4: the checks to run again. A hearing answers all three sound checks, so when one is heard again the
 * others are re-reported from that hearing (no extra work); and a fix that changed the sound (a renormalise for
 * loudness, say) hears the render again, or soundCritique's loudness rows would describe the mix before it.
 * Sound checks the report never heard (skipped: no listener, a silent render) stay as they were.
 */
export function rerunChecks(
  rerun: readonly QaCheckId[],
  report: QaReport,
  soundChanged: boolean,
): QaCheckId[] {
  const heard = report.checks.some((check) => HEARD.includes(check.id) && check.status !== 'skipped');
  const again = soundChanged || rerun.some((id) => HEARD.includes(id));
  return heard && again ? [...new Set([...rerun, ...HEARD])] : [...rerun];
}

export async function runQaWithFixes(input: FixLoopInput): AsyncResult<QaReport> {
  input.onStage?.('checking');
  const first = await input.runQa();
  if (!first.ok) return first;
  let report = first.value;
  const passes = input.maxAutoPasses ?? 2;
  for (let pass = 0; pass < passes; pass++) {
    const { auto } = planQaFixes(report);
    if (auto.length === 0) break;
    const rerun = new Set<QaCheckId>();
    let rendered = false;
    let soundChanged = false;
    for (const group of auto) {
      input.onStage?.('fixing');
      const applied = await input.applyAuto(group.action, group.checks);
      // A fix that couldn't be applied leaves its checks failing; cancellation stops everything.
      if (!applied.ok) {
        if (applied.error.code === 'core.cancelled') return applied;
        continue;
      }
      for (const check of group.checks) rerun.add(check);
      if (group.action === 'rerender' || group.action === 'reencode') rendered = true;
      if (group.action === 'renormaliseAudio') soundChanged = true;
    }
    if (rerun.size === 0) break;
    input.onStage?.('checking');
    // A new picture changes everything the file holds; an audio or container fix only its own checks.
    const only = rendered ? POST_RENDER : rerunChecks([...rerun], report, soundChanged);
    const again = await input.runQa(only, report);
    if (!again.ok) return again;
    report = again.value;
  }
  return ok(report);
}
