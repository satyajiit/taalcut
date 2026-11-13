// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createContainer,
  FrameRates,
  newId,
  ok,
  RationalTime,
  SubjectSourceToken,
  type ShortEditPlan,
  type SubjectSample,
  type SubjectSpan,
} from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { shortLayouts, shortSubjects } from '../src/utility/roots/shorts-framing';

const t = (frame: number) => RationalTime.of(frame, FrameRates.fps30);
const people = [
  { x: 0.1, y: 0.1, width: 0.25, height: 0.8 },
  { x: 0.65, y: 0.1, width: 0.25, height: 0.8 },
];
const sample = (frame: number, count = 2): SubjectSample => ({
  t: t(frame),
  source: 'detect',
  faces: [],
  humans: people.slice(0, count).map((box) => ({ box, confidence: 0.9 })),
  saliency: [],
  subject: { kind: 'none', box: null, focus: null, confidence: 0 },
});
const span: SubjectSpan = {
  frame: { width: 1920, height: 1080 },
  detector: 'vision',
  samples: [sample(30), sample(45)],
};

describe('shorts native framing inference', () => {
  it('uses stable two-person envelopes and preserves the whole frame when shots change', () => {
    expect(shortSubjects(span).people).toHaveLength(2);
    expect(shortSubjects({ ...span, samples: [sample(30), sample(45, 1)] }).people).toEqual([]);
  });

  it('tracks only selected source ranges and forwards cancellation', async () => {
    const assetId = newId<'Asset'>();
    const duration = t(60);
    const plan: ShortEditPlan = {
      candidateId: newId<'ShortCandidate'>(),
      title: 'Two people',
      hook: '',
      speech: [],
      visuals: [{ source: { assetId, range: { start: t(30), duration } }, start: t(0), duration }],
      duration,
      endingDuration: t(30),
    };
    const ensure = vi.fn(async () => ok(undefined));
    const over = vi.fn(async () => ok(span));
    const container = createContainer().value(SubjectSourceToken, { ensure, over });
    const controller = new AbortController();
    const result = await shortLayouts(container, plan, controller.signal);
    expect(result.ok && result.value.get(0)?.regions).toHaveLength(2);
    expect(ensure).toHaveBeenCalledWith([{ assetId, start: t(30), end: t(90) }], controller.signal);
    controller.abort();
    expect((await shortLayouts(container, plan, controller.signal)).ok).toBe(false);
    await container.dispose();
  });
});
