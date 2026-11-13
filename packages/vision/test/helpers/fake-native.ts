// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A native embedding backend (the mac helper's Core ML model, IX2-E5) over the fake model on `coreml`. */
import type { NativeEmbeddingBackend } from '../../src/embed/backend';
import type { EmbeddingModel } from '../../src/embed/model';
import { fakeLoader } from './fake-model';

/**
 * Available or not, failing to load or not (`state.fail` can change between loads); `becomeAvailable` is its first
 * compile finishing. With `held`, each load waits for `finishLoad()` (a slow Core ML load).
 */
export function fakeNative(options: { available: boolean; fail?: boolean; held?: boolean }) {
  const model = fakeLoader();
  let listener: (() => void) | undefined;
  const state = {
    available: options.available,
    asked: 0,
    loads: 0,
    fail: options.fail ?? false,
    disposed: 0,
  };
  let finish: () => void = () => {};
  const loadGate = () =>
    options.held
      ? new Promise<void>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve();
  const backend: NativeEmbeddingBackend = {
    async available() {
      state.asked++;
      return state.available;
    },
    async load(): Promise<EmbeddingModel> {
      state.loads++;
      await loadGate();
      if (state.fail) throw new Error('embed.prepare: embed.model_load_failed');
      const loaded = await model('/coreml', 'coreml');
      return {
        ...loaded,
        async dispose() {
          state.disposed++;
        },
      };
    },
    onAvailable(next) {
      listener = next;
    },
  };
  const becomeAvailable = () => {
    state.available = true;
    listener?.();
  };
  return { backend, state, model, becomeAvailable, finishLoad: () => finish() };
}
