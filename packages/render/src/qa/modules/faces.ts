// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * graphicCoversFace (FRM1-OVL) on the probe's text boxes. It runs on every render with a text item, whether or not a
 * clip was reframed: the heads are every clip's (facts.heads). HFW1: a composition checks heads on its own frames
 * (workspace/frames).
 */
import { FrameRate } from '@taalcut/core';
import { faceBoxesDump, faceProbeFrames, graphicCoversFaceCheck, type FaceCoverItem } from '../checks/faces';
import { autoFix, checkResult, skipped } from '../result';
import type { RunQaInput } from '../run-qa-input';
import type { QaCheckModule } from './module';

const rateOf = (plan: { rateNum: number; rateDen: number }) => FrameRate.of(plan.rateNum, plan.rateDen);

/** Every text item the render draws, on its frames. */
export function faceItems(run: RunQaInput): FaceCoverItem[] {
  return (run.plan.texts ?? []).map((text) => ({ id: text.id, span: text.span }));
}

export const facesQaModule: QaCheckModule = {
  ids: ['graphicCoversFace'],
  probeFrames: ({ run }) => faceProbeFrames(faceItems(run), rateOf(run.plan)),
  async run({ run, facts, probed }, wanted) {
    if (!wanted.has('graphicCoversFace')) return [];
    const items = faceItems(run);
    if (items.length === 0) return [skipped('graphicCoversFace')];
    // Items on screen and no probe: a capture fault, never a pass.
    if (!probed)
      return [
        checkResult(
          'graphicCoversFace',
          'fail',
          { findings: [{ target: { kind: 'file', id: 'domProbe' } }], fixes: [autoFix('rerender')] },
          0,
        ),
      ];
    const heads = facts.heads;
    const input = {
      items,
      boxes: probed.boxes,
      heads: (frame: number) => heads?.at(frame) ?? [],
      // No heads at all (a render without the stage) is a clip unseen, never a pass.
      clips: heads?.clips ?? 1,
      tracked: heads?.tracked ?? 0,
    };
    // A gate's independent check reads what the probe saw (RunQaInput.onFaceBoxes).
    await run.onFaceBoxes?.(faceBoxesDump(input));
    return [graphicCoversFaceCheck(input)];
  },
};
