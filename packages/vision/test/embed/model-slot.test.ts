// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The model slot's moves after a miss (IX2-F11): a failed move keeps the current model; a later call starts the next
 * one once the back-off is over, with no second "ready" from the backend (the Core ML backend says so once), and
 * calls inside the back-off start none, so nothing loops. The back-off doubles up to its ceiling.
 */
import type { TaalcutError } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingDevice, EmbeddingModel } from '../../src/embed/model';
import { createModelSlot, MOVE_BACKOFF_MS } from '../../src/embed/model-slot';
import { fakeLoader } from '../helpers/fake-model';
import { fakeNative } from '../helpers/fake-native';

/** A slot over WebGPU whose native loads fail while `failing` says so; `clock` drives its back-off. */
function slotWithMoves(failing: (attempt: number) => boolean) {
  const loader = fakeLoader();
  const native = fakeNative({ available: false });
  const attempts: EmbeddingDevice[] = [];
  const clock = { now: 0 };
  const slot = createModelSlot({
    load: async (): Promise<EmbeddingModel | TaalcutError> => loader('/m', 'webgpu'),
    loadNative: async (device) => {
      attempts.push(device);
      return failing(attempts.length) ? undefined : native.model('/coreml', 'coreml');
    },
    native: { coreml: native.backend },
    now: () => clock.now,
  });
  const call = async () => {
    let device: EmbeddingDevice | undefined;
    const failed = await slot.use(async (model) => {
      device = model.device;
    });
    expect(failed).toBeUndefined();
    return device;
  };
  return { slot, native, attempts, clock, call };
}

describe('the model slot after failed moves (IX2-F11)', () => {
  it('moves at a later call after three failed loads, with no second "ready"', async () => {
    const { slot, native, attempts, clock, call } = slotWithMoves((attempt) => attempt <= 4);
    // The first load is WebGPU; the try after it finds no native backend ready (the first miss).
    expect(await call()).toBe('webgpu');
    await vi.waitFor(() => expect(attempts).toHaveLength(1));
    native.becomeAvailable();
    // Three failed loads: the one the "ready" starts, then one at a call after each back-off.
    await vi.waitFor(() => expect(attempts).toHaveLength(2));
    for (const [miss, tries] of [
      [1, 3],
      [2, 4],
    ] as const) {
      // Inside the back-off, calls start nothing.
      for (let n = 0; n < 3; n++) expect(await call()).toBe('webgpu');
      expect(attempts).toHaveLength(tries - 1);
      clock.now += MOVE_BACKOFF_MS.first * 2 ** (miss - 1);
      expect(await call()).toBe('webgpu');
      await vi.waitFor(() => expect(attempts).toHaveLength(tries));
    }
    clock.now += MOVE_BACKOFF_MS.first * 4;
    expect(await call()).toBe('webgpu');
    // The fourth load after the "ready" succeeds: the next calls run on Core ML.
    await vi.waitFor(() => expect(slot.current()?.device).toBe('coreml'));
    expect(attempts).toEqual(['webgpu', 'webgpu', 'webgpu', 'webgpu', 'webgpu']);
    expect(await call()).toBe('coreml');
    clock.now += MOVE_BACKOFF_MS.max;
    expect(await call()).toBe('coreml');
    expect(attempts).toHaveLength(5);
  });

  it('doubles the back-off after each miss up to its ceiling, and a "ready" clears it', async () => {
    const { native, attempts, clock, call } = slotWithMoves(() => true);
    await call();
    await vi.waitFor(() => expect(attempts).toHaveLength(1));
    const waits: number[] = [];
    for (let n = 0; n < 9; n++) {
      const before = attempts.length;
      let waited = 0;
      while (attempts.length === before) {
        clock.now += 1_000;
        waited += 1_000;
        await call();
        // Lets a move the call started settle before the clock moves on.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      waits.push(waited);
    }
    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 320_000, 600_000, 600_000]);
    native.becomeAvailable();
    await vi.waitFor(() => expect(attempts).toHaveLength(11));
  });

  it('starts the next move as soon as a move that was asking when the "ready" came ends', async () => {
    const loader = fakeLoader();
    const native = fakeNative({ available: false });
    let answer: (model: EmbeddingModel | undefined) => void = () => {};
    let attempts = 0;
    const slot = createModelSlot({
      load: async () => loader('/m', 'webgpu'),
      loadNative: () => {
        attempts++;
        return attempts === 1
          ? new Promise((resolve) => (answer = resolve))
          : native.model('/coreml', 'coreml');
      },
      native: { coreml: native.backend },
      now: () => 0,
    });
    await slot.use(async () => {});
    await vi.waitFor(() => expect(attempts).toBe(1));
    native.becomeAvailable();
    // That move asked before the compile finished and finds nothing: the "ready" it missed starts another.
    answer(undefined);
    await vi.waitFor(() => expect(slot.current()?.device).toBe('coreml'));
    expect(attempts).toBe(2);
  });
});
