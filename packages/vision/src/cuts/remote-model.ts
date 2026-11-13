// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TransNetV2's ONNX model in an Electron utility process of its own (IX2-S2): onnxruntime-node runs a session
 * synchronously on the calling thread, so on the jobs thread every 100-frame window held it (~155 ms on WebGPU),
 * nothing read FFmpeg's pipes meanwhile, and decode and model took turns. In its own process the model has its own
 * WebGPU device (ONNX Runtime has one per process, and Dawn's is not safe from two threads) and the jobs thread
 * only waits. The process's lifecycle (lazy, shared, idle exit, failure, cancel) is the pool's (model-pool.ts).
 */
import type { AsyncResult, ComputeBackend, ComputeFallbackEvent } from '@taalcut/core';
import { ok } from '@taalcut/core';
import type { ShotModelRuntime } from './backends';
import { shotModelPool, type ShotModelPool } from './model-pool';
import { openSession, realTimers, type ModelChannel, type ModelTimers } from './model-session';
import { TRANSNET_COMPONENT } from './transnet';

export interface RemoteShotModelOptions {
  /** Starts the model's process (or thread) and gives this side's end of its channel. */
  readonly start: () => AsyncResult<ModelChannel>;
  /** The installed component's folder, or null (looked up again at every load). */
  readonly modelDir: () => Promise<string | null>;
  /** The process ends after this long without a window in flight. */
  readonly idleMs: number;
  /** How long a starting process may take to say its model is ready. */
  readonly startMs: number;
  /** The provider a lease reports before its process has said which one it opened on. */
  readonly expectedBackend: ComputeBackend;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  readonly timers?: ModelTimers;
  /** Where the model's process opens TransNetV2, from this process's probe; asked at each open. */
  readonly runtime?: () => Promise<ShotModelRuntime | undefined>;
}

export type RemoteShotModel = ShotModelPool;

export function remoteShotModel(options: RemoteShotModelOptions): RemoteShotModel {
  const timers = options.timers ?? realTimers;
  const { startMs, onFallback } = options;
  return shotModelPool({
    component: TRANSNET_COMPONENT,
    modelDir: options.modelDir,
    idleMs: options.idleMs,
    expectedBackend: options.expectedBackend,
    timers,
    open: async (modelDir) => {
      const runtime = await options.runtime?.();
      const channel = await options.start();
      // The pool turns its failure into the model failing.
      if (!channel.ok) return channel;
      return ok(
        openSession(channel.value, {
          modelDir,
          startMs,
          timers,
          ...(onFallback ? { onFallback } : {}),
          ...(runtime ? { runtime } : {}),
        }),
      );
    },
  });
}
