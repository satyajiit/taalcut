// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * runQa: every check on a muxed render, in one video decode pass, two audio
 * passes and one DOM probe pass (docs/qa-gate.md, rule 6), into a QaReport.
 * Preflight results come in from before the render and stay in the report.
 * A measurement that fails makes its checks fail with a re-render fix,
 * never pass: QA that can't see the file can't approve it.
 */
import { CancelledError, err, ok, type AsyncResult, type QaCheckId, type QaReport } from '@taalcut/core';
import { rightsReferenceAudioCheck } from './checks/preflight';
import { QA_MODULES } from './modules';
import { formatPass } from './passes/format-pass';
import { picturePass } from './passes/picture-pass';
import type { PassScope } from './passes/scope';
import { levelPass, syncPass } from './passes/sound-passes';
import { captionResults, probeAll } from './probe-pass';
import type { QaContext, RunQaInput } from './run-qa-input';
import { QA_CHECKS } from './result';
import { mergeRerun, orderChecks, verdictOf } from './verdict';

export type { QaContext, RunQaInput } from './run-qa-input';

const PREFLIGHT_ONLY = new Set<QaCheckId>(['preflightMedia', 'preflightFonts']);

/** The DOM probe's checks: captions, the Phase 3 modules (qa/modules) on one probe pass, and the rights check. */
async function probedChecks(scope: PassScope) {
  const { input, wanted } = scope;
  const known = input.facts ?? {};
  const modules = QA_MODULES.filter((module) => module.ids.some((id) => wanted.has(id)));
  const moduleFrames = modules.flatMap((module) => [...module.probeFrames({ run: input, facts: known })]);
  const probed = await probeAll(input, wanted, moduleFrames);
  const results = await captionResults(input, wanted, probed);
  const signal = scope.ctx.signal;
  for (const module of modules)
    results.push(
      ...(await module.run(
        { run: input, facts: known, probed: probed.frames, ...(signal ? { signal } : {}) },
        wanted,
      )),
    );
  if (
    wanted.has('rightsReferenceAudio') &&
    !input.preflight?.some((check) => check.id === 'rightsReferenceAudio')
  )
    results.push(
      await rightsReferenceAudioCheck({
        music: input.plan.audio.music,
        referenceAudio: input.plan.audio.referenceAudio,
        target: input.target,
      }),
    );
  return results;
}

export async function runQa(input: RunQaInput, ctx: QaContext): AsyncResult<QaReport> {
  try {
    return await checkRender(input, ctx);
  } finally {
    // EAR1-R4: a hearing started for the file that this run didn't take is never read: stop it.
    input.facts?.listening?.dropPrefetch?.();
  }
}

async function checkRender(input: RunQaInput, ctx: QaContext): AsyncResult<QaReport> {
  const wanted = new Set<QaCheckId>(
    (input.only ?? QA_CHECKS.map((meta) => meta.id)).filter((id) => !PREFLIGHT_ONLY.has(id)),
  );
  const scope: PassScope = { input, ctx, wanted };
  const cancelled = () => ctx.signal?.aborted === true;
  const format = await formatPass(scope);
  if (cancelled()) return err(CancelledError());
  const picture = await picturePass(scope);
  if (!picture.ok || cancelled()) return err(CancelledError());
  const [sync, levels, probed] = await Promise.all([
    syncPass(scope, format.facts, picture.value.scores),
    levelPass(scope),
    probedChecks(scope),
  ]);
  if (cancelled()) return err(CancelledError());
  const results = [
    ...format.results,
    ...picture.value.results,
    ...sync,
    ...levels,
    ...probed,
  ];

  const fresh = orderChecks([
    ...(input.preflight ?? []).filter((check) => !results.some((r) => r.id === check.id)),
    ...results,
  ]);
  const checks = input.previous && input.only ? mergeRerun(input.previous.checks, results) : fresh;
  const overrides = input.previous?.overrides ?? [];
  return ok({
    version: 1,
    renderId: input.renderId,
    round: input.round,
    verdict: verdictOf(checks, overrides),
    presetId: input.preset.id,
    checks,
    overrides,
    createdAt: ctx.clock.now(),
  });
}
