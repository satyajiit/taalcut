// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test support (tests only; dependency-cruiser keeps it out of app and package code).
 *
 * A stand-in for TransNetV2 (NOT the model): frame i of a window is a shot's last when the mean absolute
 * difference to frame i+1 is over `change` (0–255), on both heads. Enough for hard cuts between unrelated
 * synthetic patterns, so tests of the model path run without the component.
 */
import { ok } from '@taalcut/core';
import type { ShotBoundaryModel } from './cuts/transnet';
import { WINDOW_FRAMES } from './cuts/windows';

export function pictureChangeModel(change = 40): ShotBoundaryModel & { readonly windows: number } {
  let windows = 0;
  return {
    id: 'picture-change',
    backend: 'cpu',
    get windows() {
      return windows;
    },
    async predict(window) {
      windows += 1;
      const size = window.length / WINDOW_FRAMES;
      const single = new Float32Array(WINDOW_FRAMES);
      for (let i = 0; i + 1 < WINDOW_FRAMES; i++) {
        let sum = 0;
        for (let k = 0; k < size; k++)
          sum += Math.abs((window[(i + 1) * size + k] ?? 0) - (window[i * size + k] ?? 0));
        single[i] = sum / size > change ? 1 : 0;
      }
      return ok({ single, manyHot: Float32Array.from(single) });
    },
    release: async () => undefined,
  };
}
