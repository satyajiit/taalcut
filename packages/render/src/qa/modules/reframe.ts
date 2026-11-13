// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** subjectInFrame, cropJitter and captionCoversFace (P3-V2) on the probe's crops at 2 fps. */
import { FrameRate } from '@taalcut/core';
import { captionCoversFaceCheck, cropJitterCheck, subjectInFrameCheck } from '../checks/reframe';
import {
  layoutSubjectCheck,
  layoutCaptionCheck,
  layoutJitterCheck,
  mergeLayoutCheck,
} from '../checks/visual-layout';
import { skipped } from '../result';
import type { QaCheckModule } from './module';

const IDS = ['subjectInFrame', 'cropJitter', 'captionCoversFace'] as const;

export const reframeQaModule: QaCheckModule = {
  ids: IDS,
  probeFrames({ run, facts }) {
    const clips = facts.reframe?.clips.filter((clip) => clip.framing.kind === 'crop') ?? [];
    const step = Math.max(1, Math.round(run.plan.rateNum / run.plan.rateDen / 2));
    const frames: number[] = [];
    for (const clip of [
      ...clips,
      ...(facts.reframe?.layouts ?? []).map((entry) => ({ visible: entry.visual.visible })),
    ])
      for (let frame = clip.visible.start; frame < clip.visible.end; frame += step) frames.push(frame);
    return frames;
  },
  async run({ run, facts, probed }, wanted) {
    const reframe = facts.reframe;
    if (!reframe || (reframe.clips.length === 0 && !reframe.layouts?.length))
      return IDS.filter((id) => wanted.has(id)).map((id) => skipped(id));
    const input = {
      clips: reframe.clips,
      canvas: { width: run.plan.width, height: run.plan.height },
      rate: FrameRate.of(run.plan.rateNum, run.plan.rateDen),
      target: run.target,
      transitions: reframe.transitions,
      ...(probed ? { probed: probed.visuals } : {}),
    };
    const layoutInput = { ...input, clips: reframe.layouts ?? [] };
    const results = [];
    if (wanted.has('subjectInFrame'))
      results.push(mergeLayoutCheck(subjectInFrameCheck(input), layoutSubjectCheck(layoutInput)));
    if (wanted.has('cropJitter'))
      results.push(mergeLayoutCheck(cropJitterCheck(input), layoutJitterCheck(layoutInput)));
    if (wanted.has('captionCoversFace'))
      results.push(
        mergeLayoutCheck(
          captionCoversFaceCheck({ ...input, captions: probed?.boxes ?? [], safe: run.preset.safe }),
          layoutCaptionCheck(layoutInput, probed?.boxes ?? []),
        ),
      );
    return results;
  },
};
