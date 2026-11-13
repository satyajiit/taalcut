// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The fix loop: auto fixes in place (cheapest first), their checks again, and never a fourth round. */
import { describe, expect, it } from 'vitest';
import { CancelledError, err, ok, QA_MAX_ROUNDS, UnknownError, type QaCheckId, type QaReport } from '@taalcut/core';
import { nextRound, runQaWithFixes, type AutoAction } from '../../src/qa/fix-loop';
import { planQaFixes } from '../../src/qa/fixes';
import { agentFix, autoFix, checkResult, commandFix, QA_CHECKS } from '../../src/qa/result';
import { mergeRerun, verdictOf } from '../../src/qa/verdict';
import { report } from './support';

const fail = (id: QaCheckId, ...actions: AutoAction[]) => checkResult(id, 'fail', { fixes: actions.map(autoFix) }, 0);
const pass = (id: QaCheckId) => checkResult(id, 'pass', {}, 0);

/** A runQa whose checks come out of `outcomes`, one map per run (an unlisted check passes). */
function scripted(first: QaReport, outcomes: readonly Partial<Record<QaCheckId, 'pass' | 'fail'>>[]) {
  const calls: { only?: readonly QaCheckId[] }[] = [];
  const runQa = async (only?: readonly QaCheckId[], previous?: QaReport) => {
    calls.push(only ? { only } : {});
    if (!only || !previous) return ok(first);
    const outcome = outcomes[calls.length - 2] ?? {};
    const rerun = only.map((id) => (outcome[id] === 'fail' ? fail(id, 'rerender') : pass(id)));
    const checks = mergeRerun(previous.checks, rerun);
    return ok({ ...previous, checks, verdict: verdictOf(checks, previous.overrides) });
  };
  return { runQa, calls };
}

describe('planQaFixes', () => {
  it('orders auto fixes cheapest first and leaves command and agent fixes to the Reviewer', () => {
    const qa = report([
      fail('frameRate', 'rerender'),
      fail('codec', 'reencode'),
      fail('loudness', 'renormaliseAudio'),
      fail('container', 'remux'),
      checkResult('captionSafeZone', 'fail', { fixes: [commandFix('qa.fixes.moveCaptions', 'captions.setStyle', {})] }, 0),
      checkResult('frozenFrames', 'warn', { fixes: [autoFix('rerender'), agentFix('qa.fixes.swapOrTrimStatic', { clipId: 'a' })] }, 0),
    ]);
    const planned = planQaFixes(qa);
    expect(planned.auto).toEqual([
      { action: 'renormaliseAudio', checks: ['loudness'] },
      { action: 'remux', checks: ['container'] },
      { action: 'reencode', checks: ['codec'] },
      { action: 'rerender', checks: ['frameRate'] },
    ]);
    expect(planned.commands.map((entry) => entry.check)).toEqual(['captionSafeZone']);
    // A warning's auto fix never costs a re-render; its agent fix is still offered.
    expect(planned.agent.map((entry) => entry.check)).toEqual(['frozenFrames']);
  });
});

describe('runQaWithFixes', () => {
  it('renormalises, re-runs only loudness, and reports it fixed', async () => {
    const { runQa, calls } = scripted(report([fail('loudness', 'renormaliseAudio'), pass('codec')]), [{}]);
    const applied: AutoAction[] = [];
    const stages: string[] = [];
    const result = await runQaWithFixes({
      runQa,
      applyAuto: async (action) => (applied.push(action), ok(undefined)),
      onStage: (stage) => stages.push(stage),
    });
    expect(applied).toEqual(['renormaliseAudio']);
    expect(calls).toEqual([{}, { only: ['loudness'] }]);
    expect(stages).toEqual(['checking', 'fixing', 'checking']);
    expect(result.ok && result.value.verdict).toBe('passed');
    expect(result.ok && result.value.checks.find((check) => check.id === 'loudness')?.status).toBe('fixed');
  });

  it('re-runs every post-render check after a re-render', async () => {
    const { runQa, calls } = scripted(report([fail('blackFrames', 'rerender')]), [{}]);
    await runQaWithFixes({ runQa, applyAuto: async () => ok(undefined) });
    const postRender = QA_CHECKS.filter((meta) => !meta.preflight).map((meta) => meta.id);
    expect(calls[1]?.only).toEqual(postRender);
    expect(calls[1]?.only).not.toContain('captionGlyphs');
  });

  it('stops after two passes and leaves a stubborn failure for the user', async () => {
    const { runQa, calls } = scripted(report([fail('frozenFrames', 'rerender')]), [{ frozenFrames: 'fail' }, { frozenFrames: 'fail' }]);
    const result = await runQaWithFixes({ runQa, applyAuto: async () => ok(undefined) });
    expect(calls).toHaveLength(3);
    expect(result.ok && result.value.verdict).toBe('needsAttention');
  });

  it('keeps a check failing when its fix could not be applied, and stops on cancel', async () => {
    const { runQa, calls } = scripted(report([fail('container', 'remux')]), []);
    const unapplied = await runQaWithFixes({ runQa, applyAuto: async () => err(UnknownError()) });
    expect(unapplied.ok && unapplied.value.verdict).toBe('needsAttention');
    expect(calls).toHaveLength(1);
    const cancelled = await runQaWithFixes({ runQa, applyAuto: async () => err(CancelledError()) });
    expect(cancelled.ok ? undefined : cancelled.error.code).toBe('core.cancelled');
  });

  it('does nothing more when nothing auto-fixable fails', async () => {
    const { runQa, calls } = scripted(report([pass('codec')]), []);
    await runQaWithFixes({ runQa, applyAuto: async () => ok(undefined) });
    expect(calls).toHaveLength(1);
  });
});

describe('nextRound', () => {
  it('counts rounds across re-exports and refuses a fourth', () => {
    expect(nextRound(null)).toEqual(ok(1));
    expect(nextRound(2)).toEqual(ok(3));
    const fourth = nextRound(QA_MAX_ROUNDS);
    expect(fourth.ok ? undefined : fourth.error).toMatchObject({ code: 'render.qa_rounds_exhausted', params: { rounds: 3 } });
  });
});
