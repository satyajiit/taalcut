// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The video pass: black, frozen and bars checks, beatSync, and the cut positions avSync reads. */
import { CancelledError, err, FrameRate, ok, type QaCheckResult, type Result } from '@taalcut/core';
import { beatSyncCheck } from '../checks/sync';
import { blackBarsCheck, blackFramesCheck, frozenFramesCheck } from '../checks/video';
import { runVideoPass } from '../measure/video-pass';
import { unmeasured } from '../unmeasured';
import { segmentPasses } from './segment-passes';
import { segmentView, sourceStillness } from './source-stillness';
import { timed, wants, type PassScope } from './scope';

export interface PicturePass {
  readonly results: QaCheckResult[];
  /** Scene-change scores per frame (empty when the pass didn't run). */
  readonly scores: readonly number[];
}

export async function picturePass(scope: PassScope): Promise<Result<PicturePass>> {
  if (!wants(scope, 'blackFrames', 'frozenFrames', 'blackBars', 'avSync', 'beatSync'))
    return ok({ results: [], scores: [] });
  const { input, ctx } = scope;
  const started = performance.now();
  const options = {
    rate: FrameRate.of(input.plan.rateNum, input.plan.rateDen),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    ...(ctx.onFallback ? { onFallback: ctx.onFallback } : {}),
    ...(ctx.decode ? { decode: ctx.decode } : {}),
  };
  const pass = await runVideoPass(ctx.media, input.file, options);
  if (!pass.ok && pass.error.code === 'media.cancelled') return err(CancelledError());
  const group: QaCheckResult[] = [];
  const scores = pass.ok ? pass.value.sceneScores : [];
  if (pass.ok) {
    const segments = segmentPasses(ctx.media, input.segments, options);
    // A freeze is asked of each clip's footage as the render frames it: reframed clips by their crop or pad.
    const reframed = new Map((input.facts?.reframe?.clips ?? []).map((clip) => [clip.clipId, clip]));
    const canvas = { width: input.plan.width, height: input.plan.height };
    const view = (clipId: string) => segmentView(reframed.get(clipId), canvas);
    const stillness = sourceStillness(ctx.media, input.segments, view, options);
    if (wants(scope, 'blackFrames')) group.push(await blackFramesCheck(pass.value, input.plan, segments));
    if (wants(scope, 'frozenFrames')) group.push(await frozenFramesCheck(pass.value, input.plan, stillness));
    if (wants(scope, 'blackBars')) group.push(blackBarsCheck(pass.value, input.plan));
  } else {
    for (const id of ['blackFrames', 'frozenFrames', 'blackBars'] as const)
      if (scope.wanted.has(id)) group.push(unmeasured(id, 'videoPass'));
  }
  if (wants(scope, 'beatSync'))
    group.push(
      pass.ok ? beatSyncCheck(input.plan, scores, input.target) : unmeasured('beatSync', 'videoPass'),
    );
  return ok({ results: timed(group, started), scores });
}
