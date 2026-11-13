// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `vision.readShotText` handler (IX-O5): the shots' 1 fps frames from the
 * pass's cache (what `vision.shots` left), read through the routed OCR engine
 * in windows, with the job's OCR counts in the output for the bench. The job
 * releases the asset's frames when it succeeds. Without an OCR engine in this
 * process it reads nothing and stores no text, as the analysis did.
 *
 * When no shot shows text after a read, `vision.embedOcr` skips, so the asset's
 * on-screen-text vectors go here: they are keyed by shots a re-detection may
 * have replaced (IX2-C5, IX2-F3). With text, `vision.embedOcr` replaces them.
 * With no engine, the shots keep the text an earlier engine read (PO decision
 * F3) and their vectors stay; only the vectors of shots that are gone go
 * (IX2-F12). `vision.embedOcr` can't be relied on to tidy up: it re-runs when
 * the detector's version rises, not when only this stage's does.
 */
import { ok, registerJob, type JobRegistration, type Result } from '@taalcut/core';
import { createOcrMeter } from '../ocr/meter';
import { readShotText } from '../ocr/shot-text';
import { BREAKDOWN_JOB_STAGES } from './breakdown-kinds';
import type { VisionJobDeps } from './deps';
import { FRAME_CONSUMERS, withAssetFrames } from './frame-jobs';
import { visionReadShotTextJob, type ReadShotTextInput } from './ocr-kinds';
import { keepShotVectors } from './shot-vectors';

export function ocrJobRegistrations(deps: VisionJobDeps): JobRegistration[] {
  return [
    registerJob(visionReadShotTextJob, async (input, context) => {
      context.progress({ fraction: 0, stageKey: BREAKDOWN_JOB_STAGES.readingText });
      const meter = createOcrMeter();
      const { ocr } = deps;
      if (!ocr) {
        const kept = keepStoredTextVectors(deps, input);
        return kept.ok ? ok({ shots: [], ocr: meter.counts() }) : kept;
      }
      const use = { consumer: FRAME_CONSUMERS.ocr };
      const read = await withAssetFrames(deps, input, context.signal, use, (frames) =>
        readShotText(input.shots, frames, ocr, input.languages, { signal: context.signal, meter }),
      );
      if (!read.ok) return read;
      if (read.value.value.every((shot) => shot.onScreenText.length === 0)) {
        const removed = dropTextVectors(deps, input.assetId);
        if (!removed.ok) return removed;
      }
      context.progress({ fraction: 1, stageKey: BREAKDOWN_JOB_STAGES.readingText });
      return ok({ shots: read.value.value, ocr: meter.counts(), decodes: read.value.decodes });
    }),
  ];
}

/** The asset's on-screen-text vectors, removed when it shows no text this time. */
function dropTextVectors(deps: VisionJobDeps, assetId: string): Result<number> {
  return deps.index ? deps.index.removeWhere({ assetId, kind: 'ocr' }) : ok(0);
}

/**
 * With no engine: the vectors of the text stored on the job's shots stay, the asset's others (shots that are gone)
 * go. A job from before IX2-F12 doesn't say which shot has text, so it drops them all as it did.
 */
function keepStoredTextVectors(deps: VisionJobDeps, input: ReadShotTextInput): Result<number> {
  const { index } = deps;
  if (!index) return ok(0);
  if (input.sourceId === undefined) return dropTextVectors(deps, input.assetId);
  return keepShotVectors(index, {
    assetId: input.assetId,
    sourceId: input.sourceId,
    kind: 'ocr',
    current: input.shots.flatMap((shot) =>
      Array.from({ length: shot.textTracks ?? 0 }, (_, n) => `ocr:${shot.shotId}:${n}`),
    ),
    items: [],
  });
}
