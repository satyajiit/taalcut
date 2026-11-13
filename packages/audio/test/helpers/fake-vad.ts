// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A stand-in for Silero: loud windows are voice. */
import { CancelledError, err, ok } from '@taalcut/core';
import type { VadEngine, VadStream } from '../../src/cleanup/vad';

const RATE = 16_000;

/** Probability 1 for a 512-sample window whose mean level is over 0.05; counts what it was fed. */
export function loudnessVad(): VadEngine & { readonly fed: () => number } {
  let fed = 0;
  const stream = (): VadStream => {
    let pending = new Float32Array(0);
    return {
      async push(samples, signal) {
        if (signal?.aborted) return err(CancelledError());
        fed += samples.length;
        const all = new Float32Array(pending.length + samples.length);
        all.set(pending, 0);
        all.set(samples, pending.length);
        const windows = Math.floor(all.length / 512);
        const out = new Float32Array(windows);
        for (let w = 0; w < windows; w++) {
          let sum = 0;
          for (let i = 0; i < 512; i++) sum += Math.abs(all[w * 512 + i] ?? 0);
          out[w] = sum / 512 > 0.05 ? 1 : 0;
        }
        pending = all.slice(windows * 512);
        return ok(out);
      },
    };
  };
  return {
    probabilities: async () => ok({ probabilities: new Float32Array(0), windowMs: 32, backend: 'cpu' }),
    stream,
    fed: () => (fed * 1000) / RATE,
  };
}
