// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Frames carry their image-token budget in their size (IX2-E1): index frames at the machine's budget, calibrated
 * frames at 280, and a model call never mixes the two.
 */
import { describe, expect, it } from 'vitest';
import { createEmbedder } from '../../src/embed/embedder';
import { sameBudget } from '../../src/embed/model';
import { DEFAULT_EMBEDDING_PROFILE } from '../../src/embed/profile';
import { budgetOfFrame, embeddingFrameSize, IMAGE_TOKEN_BUDGETS } from '../../src/embed/space';
import { fakeLoader } from '../helpers/fake-model';

const frame = (width: number, height: number, value = 0) => ({
  width,
  height,
  rgb: new Uint8Array(width * height * 3).fill(value),
});

describe('frame budgets', () => {
  it('reads the budget a frame was sized for from its size', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [3840, 2160],
      [1080, 1350],
      [2560, 1080],
    ] as const) {
      for (const budget of IMAGE_TOKEN_BUDGETS) {
        expect(budgetOfFrame(embeddingFrameSize(w, h, budget))).toBe(budget);
      }
    }
    expect(budgetOfFrame({ width: 1920, height: 1080 })).toBeUndefined();
    expect(budgetOfFrame({ width: 48, height: 48 })).toBeUndefined();
  });

  it('refuses a model call whose frames were sized for different budgets', () => {
    const wide = embeddingFrameSize(1920, 1080, 280);
    const small = embeddingFrameSize(1920, 1080, 140);
    expect(sameBudget([frame(wide.width, wide.height), frame(wide.width, wide.height)])).toBe(280);
    expect(sameBudget([frame(small.width, small.height)])).toBe(140);
    expect(() => sameBudget([frame(wide.width, wide.height), frame(small.width, small.height)])).toThrow(
      /one image-token budget/,
    );
    expect(() => sameBudget([frame(100, 100)])).toThrow(/one image-token budget/);
  });

  it('splits a call where the frames change budget, in arrival order', async () => {
    const loader = fakeLoader();
    const embedder = createEmbedder({
      modelDir: '/m',
      loader,
      profile: { ...DEFAULT_EMBEDDING_PROFILE, imageTokens: 70, batchTokens: 2048 },
    });
    const index = await embedder.frameSize(1920, 1080, 'index');
    const calibrated = await embedder.frameSize(1920, 1080, 'calibrated');
    const [a, b] = await Promise.all([
      embedder.embedImages([frame(index.width, index.height, 1), frame(index.width, index.height, 2)]),
      embedder.embedImages([
        frame(calibrated.width, calibrated.height, 3),
        frame(calibrated.width, calibrated.height, 4),
      ]),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(loader.calls.map((call) => call.inputs)).toEqual([
      ['528x288', '528x288'],
      ['1056x576', '1056x576'],
    ]);
  });
});
