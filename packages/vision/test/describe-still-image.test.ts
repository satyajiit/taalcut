// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * vision.describeFrame on a still image: one frame, at time 0, whatever the call asked. At BRK1's gate a local model
 * passed a frame number as the time for a breakdown's JPEG, and no frame decoded.
 */
import { describeFrameOutputSchema, visionToolModule, type VisionDeps } from '@taalcut/vision';
import { describe, expect, it } from 'vitest';
import {
  fakeJobs,
  GEMINI,
  mutableSelector,
  OLLAMA_VL,
  scriptedClient,
  testRuntime,
  testToolContext,
} from './helpers/fakes';

function setup() {
  const jobs = fakeJobs();
  const models = scriptedClient(() => [
    { choice: GEMINI, local: false, outcome: { text: 'A station platform.', costUsd: 0.0004 } },
  ]);
  const deps: VisionDeps = {
    jobs,
    models,
    selector: mutableSelector([OLLAMA_VL, GEMINI]),
    runtime: testRuntime(),
  };
  return { tool: visionToolModule(deps).tools[0]!, jobs };
}

describe('describeFrame on a still image', () => {
  it.each(['/scratch/exp-1/strips/strip-000282.jpg', '/Trip/poster.PNG', '/Trip/photo.heic'])(
    'reads %s at 0, and says so',
    async (path) => {
      const { tool, jobs } = setup();
      const result = await tool.run(
        { path, at: { value: 282, rate: 1 }, detail: 'normal' },
        testToolContext(),
      );
      expect(result.ok && describeFrameOutputSchema.parse(result.value).at).toEqual({ value: 0, rate: 1 });
      expect(jobs.calls).toMatchObject([
        { kind: 'media.extractFrame', input: { path, at: { value: 0, rate: 1 } } },
      ]);
      expect(tool.describeCall?.({ path, at: { value: 282, rate: 1 }, detail: 'normal' }, undefined)).toMatch(
        /· 0:00$/,
      );
    },
  );

  it('keys a still image once, whatever time is asked', () => {
    const { tool } = setup();
    const key = (value: number) =>
      tool.idempotencyKey?.({ path: '/nope/a.jpg', at: { value, rate: 1 }, detail: 'normal' });
    expect(key(282)).toBe(key(0));
  });

  it.each(['/Trip/IMG_0420.MOV', '/Trip/loop.gif'])('keeps the asked time for %s', async (path) => {
    const { tool, jobs } = setup();
    await tool.run({ path, at: { value: 75, rate: 30 }, detail: 'normal' }, testToolContext());
    expect(jobs.calls).toMatchObject([{ input: { at: { value: 75, rate: 30 } } }]);
  });
});
