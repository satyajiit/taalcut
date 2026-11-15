// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: the describer asked for a shot's moments, with a scripted ModelClient: each picture after its number and
 * time and the larger answer budget, the moments stored with the description, one more ask when they can't be used,
 * and the sentence kept either way. A shot without a span is asked as before. MOM2: a run the model states as the
 * camera being handled is stored so.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameRate } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VISION_CONFIG } from '../../src/config';
import {
  describeShots,
  RETRY_TEMPERATURE,
  SHOT_DESCRIPTION_PROMPT,
  SHOT_MOMENTS_PROMPT,
} from '../../src/describe/describe-shots';
import { mutableSelector, OLLAMA_VL, scriptedClient, testRuntime } from '../helpers/fakes';
import { makeReel, testMedia } from '../helpers/reel';

const { ctx } = await testMedia('describe moments');

const SENTENCE = { description: 'A pattern turns on a screen, then holds.', objects: ['screen'], people: 0 };
const WITH_MOMENTS = JSON.stringify({
  ...SENTENCE,
  moments: [
    { fromFrame: 1, toFrame: 1, note: 'A pattern turns on a screen.' },
    { fromFrame: 2, toFrame: 2, note: 'The pattern holds still.' },
  ],
});
const WITHOUT = JSON.stringify(SENTENCE);

describe.skipIf(!ctx)('describeShots with moments', () => {
  let dir: string;
  let path: string;
  const rate = FrameRate.of(30);
  /** A 2 s shot from frame 0, seen at two frames. */
  const shot = { shotId: 's1', frame: 3, frames: [15, 45], span: { start: 0, length: 60 } };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-moments-'));
    path = join(dir, 'clip.mp4');
    await makeReel(ctx!, path, [{ source: 'testsrc2', frames: 60 }], { width: 640, height: 360, rate: '30' });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const modelsWith = (answers: string[]) => {
    let call = 0;
    const client = scriptedClient(() => [
      { choice: OLLAMA_VL, local: true, outcome: { text: answers[Math.min(call++, answers.length - 1)]! } },
    ]);
    return { client, selector: mutableSelector([OLLAMA_VL]), runtime: testRuntime() };
  };

  it('numbers the pictures, allows a longer answer, and stores the moments in frames of the shot', async () => {
    const models = modelsWith([WITH_MOMENTS]);
    const result = await describeShots(
      { path, rate, shots: [shot] },
      { media: ctx!, models },
      { placement: 'local' },
    );
    expect(result.ok && result.value.descriptions[0]?.description).toMatchObject({
      text: 'A pattern turns on a screen, then holds.',
      // Two frames, each standing for half of the shot's 60 frames.
      moments: [
        { start: 0, end: 30, note: 'A pattern turns on a screen.' },
        { start: 30, end: 60, note: 'The pattern holds still.' },
      ],
    });
    const request = models.client.requests[0]!;
    expect(request.system).toBe(SHOT_MOMENTS_PROMPT);
    expect(request.maxTokens).toBe(VISION_CONFIG.describe.moments.maxTokens);
    const first = request.messages[0]!;
    const content = (first.role === 'user' ? first.content : []) as { type: string; text?: string }[];
    expect(content.map((part) => part.type)).toEqual(['text', 'image', 'text', 'image']);
    expect(content[0]!.text).toContain(
      'These 2 numbered frames are in chronological order from one continuous shot 2 s long',
    );
    expect(content[0]!.text).toMatch(/Frame 1, at 0\.5 s:$/);
    expect(content[2]!.text).toBe('Frame 2, at 1.5 s:');
    expect(models.client.requests).toHaveLength(1);
  });

  it('asks once more when the moments cannot be used, and keeps the sentence when they still cannot', async () => {
    const second = modelsWith([WITHOUT, WITH_MOMENTS]);
    const fixed = await describeShots(
      { path, rate, shots: [shot] },
      { media: ctx!, models: second },
      { placement: 'local' },
    );
    expect(fixed.ok && fixed.value.descriptions[0]?.description.moments).toHaveLength(2);
    expect(second.client.requests).toHaveLength(2);
    expect(second.client.requests[1]!.temperature).toBe(RETRY_TEMPERATURE);
    expect(JSON.stringify(second.client.requests[1]!.messages)).toContain('it had no usable \\"moments\\"');

    // Never usable: two asks, then the first answer's sentence with no moments. The stage does not fail.
    const never = modelsWith([
      WITHOUT,
      '{"description": "Another wording.", "objects": [], "moments": "none"}',
    ]);
    const kept = await describeShots(
      { path, rate, shots: [shot] },
      { media: ctx!, models: never },
      { placement: 'local' },
    );
    expect(kept.ok && kept.value.descriptions[0]?.description.text).toBe(SENTENCE.description);
    expect(kept.ok && kept.value.descriptions[0]?.description.moments).toBeUndefined();
    expect(never.client.requests).toHaveLength(2);

    // The second answer is no JSON at all: the first still stands.
    const broken = modelsWith([WITHOUT, 'I cannot do that.']);
    const stood = await describeShots(
      { path, rate, shots: [shot] },
      { media: ctx!, models: broken },
      { placement: 'local' },
    );
    expect(stood.ok && stood.value.descriptions[0]?.description.text).toBe(SENTENCE.description);
  });

  it('stores a run the model states as the camera being handled, from the stated field alone (MOM2)', async () => {
    const stated = JSON.stringify({
      ...SENTENCE,
      moments: [
        { fromFrame: 1, toFrame: 1, note: 'A pattern turns on a screen.', camera: 'filming' },
        { fromFrame: 2, toFrame: 2, note: 'The pattern holds still.', camera: 'handling' },
      ],
    });
    const models = modelsWith([stated]);
    const result = await describeShots(
      { path, rate, shots: [shot] },
      { media: ctx!, models },
      { placement: 'local' },
    );
    // The second frame's half of the shot, and back to the first frame itself (frame 15): the time between the
    // two was not seen held. The sentence is as it was; the ask has the statement and not the camera's move.
    expect(result.ok && result.value.descriptions[0]?.description.moments).toEqual([
      { start: 0, end: 15, note: 'A pattern turns on a screen.' },
      { start: 15, end: 60, note: 'The pattern holds still.', handling: true },
    ]);
    expect(models.client.requests).toHaveLength(1);
    expect(models.client.requests[0]!.system).toContain('"camera": "filming" or "handling"');
    expect(models.client.requests[0]!.system).not.toContain('cameraMotion');
  });

  it('asks a shot without a span as before MOM1: no times, no moments, the old budget', async () => {
    const models = modelsWith([WITH_MOMENTS]);
    const result = await describeShots(
      {
        path,
        rate,
        shots: [
          { shotId: 's1', frame: 3, frames: [15, 45] },
          { shotId: 's2', frame: 20 },
        ],
      },
      { media: ctx!, models },
      { placement: 'local' },
    );
    expect(result.ok && result.value.descriptions.map((d) => d.description.moments)).toEqual([
      undefined,
      undefined,
    ]);
    for (const request of models.client.requests) {
      expect(request.system).toBe(SHOT_DESCRIPTION_PROMPT);
      expect(request.maxTokens).toBe(VISION_CONFIG.describe.maxTokens);
    }
    expect(models.client.requests).toHaveLength(2);
  });
});
