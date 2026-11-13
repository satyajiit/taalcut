// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The OCR helper's warm-up, once per jobs process (FIX-OCRCOLD). Apple Vision compiles its models for this Mac's
 * Neural Engine the first time a helper build runs them, which on a new install or update took from 24 s to over
 * 4 minutes a model on a busy Mac. Starting the helper with the jobs process lets it compile them in the background
 * before the person's first breakdown reads text, and the Core ML embedder's own first compile waits for it
 * (vision-coreml.ts `yieldTo`). Once a build has compiled them the warm-up takes about a second, and the helper
 * exits idle as usual. Once it has answered, other helper builds' compile caches are let go (helper-build-caches.ts).
 */
import { describeWarmUp, type OcrEngine } from '@taalcut/vision';
import type { BuildCachePrune } from './helper-build-caches';

/** Lets go of other helper builds' compile caches, keeping this build's (`keep`, from the warm-up's report). */
export type PruneBuildCaches = (keep: string | undefined) => BuildCachePrune;

/** Runs the engine's warm-up the first time it is called, and logs what it did; never fails. */
export function ocrWarmUp(
  engine: OcrEngine,
  log: (line: string) => void,
  prune?: PruneBuildCaches,
): () => Promise<void> {
  let run: Promise<void> | undefined;
  return () =>
    (run ??= (async () => {
      const report = await engine.warm?.();
      if (!report) return;
      if (!report.ok) {
        // No helper (a test build, another platform) is not worth a line; anything else is.
        if (report.error.code !== 'vision.ocr_unavailable' && report.error.code !== 'media.sidecar_not_found')
          log(`[vision] OCR warm-up didn't run (${report.error.code}): text reads compile as they come`);
        return;
      }
      if (!report.value) return;
      log(`[vision] ${describeWarmUp(report.value)}`);
      if (!prune) return;
      try {
        const pruned = prune(report.value.cache);
        if (pruned.discarded.length > 0)
          log(`[vision] let go of other mac helper builds' compile caches: ${pruned.discarded.join(', ')}`);
        // In the background: the embedder's first load waits for this warm-up, not for the deletes.
        void pruned.deleted.catch((error: unknown) =>
          log(`[vision] deleting other helper builds' compile caches failed: ${String(error)}`),
        );
      } catch (error) {
        log(`[vision] other helper builds' compile caches kept: ${String(error)}`);
      }
    })());
}
