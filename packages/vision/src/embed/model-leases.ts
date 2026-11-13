// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The calls running on each of the embedder's models (model-slot.ts, IX2-F10): a model a move replaced, or one
 * dropped, is disposed once no call runs on it, so no call runs on a disposed model.
 */
import type { EmbeddingModel } from './model';

export interface ModelLeases {
  /** Runs `call` on `model`, which is not disposed before the call ends. */
  run(model: EmbeddingModel, call: (model: EmbeddingModel) => Promise<void>): Promise<void>;
  /** `model` disposed once no call runs on it: at once when none does. */
  retire(model: EmbeddingModel): Promise<void>;
  /** `model` disposed now; a dispose that throws is logged, never thrown. */
  dispose(model: EmbeddingModel): Promise<void>;
}

/** A thrown value in a log line. */
export const describeCause = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause)).slice(0, 500);

export function modelLeases(log: (line: string) => void): ModelLeases {
  const running = new Map<EmbeddingModel, number>();
  const retired = new Map<EmbeddingModel, () => void>();

  async function dispose(model: EmbeddingModel): Promise<void> {
    try {
      await model.dispose();
    } catch (cause) {
      log(`[vision] the embedder's ${model.device} model wouldn't dispose (${describeCause(cause)})`);
    }
  }

  function release(used: EmbeddingModel): void {
    const left = (running.get(used) ?? 1) - 1;
    if (left > 0) {
      running.set(used, left);
      return;
    }
    running.delete(used);
    const disposeNow = retired.get(used);
    retired.delete(used);
    disposeNow?.();
  }

  return {
    async run(model, call) {
      running.set(model, (running.get(model) ?? 0) + 1);
      try {
        await call(model);
      } finally {
        release(model);
      }
    },
    retire(model) {
      if (!running.has(model)) return dispose(model);
      return new Promise((resolve) => retired.set(model, () => void dispose(model).then(resolve)));
    },
    dispose,
  };
}
