// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The embedder's one model (embedder.ts): loaded at the first call that needs it, once however many ask, tried again
 * after a failed load (the component may have been installed since), and moved to a native backend that comes ready
 * later (Core ML compiled in the background, IX2-E5).
 *
 * A call never waits for a move (IX2-F10). The move loads the native model in the background: at once when a native
 * backend says it is ready, or from the first call after the first load when the "ready" came during that load.
 * Calls meanwhile run on the current model; the native one takes the next call once it has loaded, and the model it
 * replaces is disposed when no call runs on it any more.
 *
 * A move that finds nothing to load (no native backend ready yet, or its load failed) keeps the current model, and a
 * later call starts another while the model isn't native (IX2-F11): one at a time, each after a back-off that doubles
 * with every miss from `MOVE_BACKOFF_MS.first` to `MOVE_BACKOFF_MS.max`. So nothing loops, and a backend that came
 * ready is never given up on while the process lives. A backend's "ready" clears the back-off and moves at once.
 */
import type { TaalcutError } from '@taalcut/core';
import type { NativeEmbeddingBackend } from './backend';
import type { EmbeddingDevice, EmbeddingModel } from './model';
import { describeCause, modelLeases } from './model-leases';

export interface ModelSlot {
  /**
   * Runs `call` on the model, loading it when there is none; the load's error when it won't load. A move never
   * holds a call up, and the model a call runs on is not disposed before the call ends.
   */
  use(call: (model: EmbeddingModel) => Promise<void>): Promise<TaalcutError | undefined>;
  /** The model the next call runs on, without loading. */
  current(): EmbeddingModel | undefined;
  /** The next call loads again; the model goes once no call runs on it. */
  drop(): Promise<void>;
}

export interface ModelSlotSources {
  /** The model on the best device there is now. */
  readonly load: () => Promise<EmbeddingModel | TaalcutError>;
  /** The model on a native device the profile puts before `device`, or undefined when none is ready and loads. */
  readonly loadNative: (device: EmbeddingDevice) => Promise<EmbeddingModel | undefined>;
  /** Native backends by device: each one's `onAvailable` starts the move. */
  readonly native?: Partial<Readonly<Record<EmbeddingDevice, NativeEmbeddingBackend>>> | undefined;
  /** What went wrong without failing a call: a move that threw, a model that wouldn't dispose. */
  readonly log?: (line: string) => void;
  /** Milliseconds for the back-off. Default `performance.now`. */
  readonly now?: () => number;
}

/** The wait after a move found nothing to load, doubling with each miss up to `max`. */
export const MOVE_BACKOFF_MS = { first: 5_000, max: 10 * 60_000 } as const;

/** When the next move may start: after each miss, `MOVE_BACKOFF_MS` later; a "ready" or a move that loads clears it. */
function moveBackoff(now: () => number) {
  let misses = 0;
  let next = 0;
  return {
    due: () => now() >= next,
    missed(): void {
      misses += 1;
      next = now() + Math.min(MOVE_BACKOFF_MS.max, MOVE_BACKOFF_MS.first * 2 ** (misses - 1));
    },
    clear(): void {
      misses = 0;
      next = 0;
    },
  };
}

export function createModelSlot(sources: ModelSlotSources): ModelSlot {
  const native = sources.native ?? {};
  const hasNative = Object.values(native).some((backend) => backend !== undefined);
  const log = sources.log ?? (() => {});
  const backoff = moveBackoff(sources.now ?? (() => performance.now()));
  const leases = modelLeases(log);
  let model: EmbeddingModel | undefined;
  let loading: Promise<EmbeddingModel | TaalcutError> | undefined;
  let moving = false;
  /** A "ready" came while a move ran (it may have asked before): the next move starts as that one ends. */
  let readyAgain = false;

  async function loaded(): Promise<EmbeddingModel | TaalcutError> {
    if (model) return model;
    loading ??= sources.load();
    const result = await loading;
    if ('code' in result) loading = undefined;
    else model = result;
    return result;
  }

  /** The native model in place of `current`, which goes once no call runs on it. */
  async function move(current: EmbeddingModel): Promise<void> {
    const next = await sources.loadNative(current.device);
    if (!next) return backoff.missed();
    backoff.clear();
    // Dropped or reloaded meanwhile (the embedder closed): the native model isn't kept; the next call decides.
    if (model !== current) return leases.dispose(next);
    model = next;
    void leases.retire(current);
  }

  /** A move in the background when the model isn't native, none is running and the back-off is over. */
  function startMove(): void {
    const current = model;
    if (!current || !hasNative || native[current.device] || moving || !backoff.due()) return;
    moving = true;
    void move(current)
      .catch((cause: unknown) => {
        backoff.missed();
        log(`[vision] the embedder's move to a native backend failed (${describeCause(cause)})`);
      })
      .finally(() => {
        moving = false;
        if (readyAgain) becameReady();
      });
  }

  function becameReady(): void {
    readyAgain = moving;
    backoff.clear();
    startMove();
  }

  for (const backend of Object.values(native)) backend?.onAvailable?.(becameReady);

  return {
    async use(call) {
      const current = await loaded();
      if ('code' in current) return current;
      startMove();
      await leases.run(current, call);
      return undefined;
    },
    current: () => model,
    async drop() {
      const previous = model;
      model = undefined;
      loading = undefined;
      if (previous) await leases.retire(previous);
    },
  };
}
