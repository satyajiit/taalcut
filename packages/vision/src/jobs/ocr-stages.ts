// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * On-screen text as its own index stage (IX-O5, `_orch/ix/specs/ocr-stage-design.md`): `vision.ocr` reads
 * each analysed shot's text after `vision.analyse` and the spoken language, on the npu class's `vision.ocr`
 * lane, and stores it in the shot's analysis as stored when the job settles.
 *
 * - **Storage.** core has no text-only result, so `result` hands back each shot's analysis with its text
 *   replaced. The pipeline builds the view it passes to `result` when the job settles (pipeline.ts
 *   `settleSucceeded`: `buildAssetIndexView`, then `applyStageResult`, in one synchronous step), so an analysis
 *   stored after the job was built is the one merged into.
 * - **Re-runs.** It reads `vision.shots` and `vision.analyse` (`reads`, round IX3) and `audio.language`
 *   (`optionalReads`, LRN1-CTX): when one of them stores something else, the pipeline reads the text again
 *   (dependent invalidation; before IX3 its version was derived from theirs, `ocrVersion`). The spoken language
 *   only routes Devanagari, so it is waited for while it is coming, but not once it failed or waits for whisper's
 *   model: on-screen text, a searchable stage, doesn't wait on whisper, and is read again once the language lands.
 *   Until it settles, an analysis re-run keeps the text stored for a shot whose range didn't move
 *   (`withStoredText`). A new shot id never gets text it didn't read.
 * - **Old libraries.** An analysis stored before this stage read its shots' text itself; its output lacks
 *   `text: 'vision.ocr'`, and the stage skips (`indexing.skip.textRead`). Without a stored output (over 1 MiB)
 *   the stage reads again: correct, and only time.
 */
import {
  defineIndexStage,
  ok,
  stageJob,
  TimeRange,
  type AssetIndexView,
  type IndexStageDefinition,
  type ShotAnalysis,
  type ShotId,
} from '@taalcut/core';
import { z } from 'zod';
import type { FrameInput } from '../media/frame-source-policy';
import { TEXT_READER } from './index-kinds';
import { visionReadShotTextJob } from './ocr-kinds';
import { frameReads, framesOf, OCR_VERSION } from './stage-frames';
import { storedText } from './stored-parts';

export const OCR_STAGE = TEXT_READER;
export const OCR_SKIP = {
  noShots: 'indexing.skip.noShots',
  notAnalysed: 'indexing.skip.notAnalysed',
  textRead: 'indexing.skip.textRead',
} as const;

export interface OcrStageOptions {
  /** Languages to read on screen besides the asset's spoken one: the app language. */
  readonly ocrLanguages: () => readonly string[];
  /** The asset's spoken language as `audio.language` stored it (apps wire audio's `storedLanguage`). */
  readonly spokenLanguage?: (view: AssetIndexView) => string | undefined;
}

const marked = z.object({ text: z.literal(TEXT_READER) });

/** The stored analysis read its shots' text itself: an output from before this stage. */
export function readByAnalysis(view: AssetIndexView): boolean {
  const output = view.outputs['vision.analyse'];
  return output !== undefined && !marked.safeParse(output).success;
}

/** The languages a job asks for: the spoken one first, then the app's, at most 8. */
export function ocrLanguagesFor(view: AssetIndexView, options: OcrStageOptions): string[] {
  const spoken = options.spokenLanguage?.(view);
  return [...new Set([...(spoken ? [spoken] : []), ...options.ocrLanguages()])].slice(0, 8);
}

/**
 * New analyses with the text stored for the same shot: an analysis re-run keeps what `vision.ocr` read, as
 * long as the shot's range is the one that text was read on.
 */
export function withStoredText(
  view: AssetIndexView,
  analyses: readonly { readonly shotId: ShotId; readonly analysis: ShotAnalysis }[],
): { shotId: ShotId; analysis: ShotAnalysis }[] {
  const stored = new Map(view.shots.map((shot) => [shot.shotId, shot.analysis]));
  return analyses.map(({ shotId, analysis }) => {
    const before = stored.get(shotId);
    const keep = before && before.onScreenText.length > 0 && TimeRange.equals(before.range, analysis.range);
    return { shotId, analysis: keep ? { ...analysis, onScreenText: before.onScreenText } : analysis };
  });
}

export function createOcrStage(options: OcrStageOptions, preferred: FrameInput): IndexStageDefinition {
  return defineIndexStage({
    stage: OCR_STAGE,
    version: OCR_VERSION,
    reads: ['vision.shots', 'vision.analyse', ...frameReads(preferred)],
    optionalReads: ['audio.language'],
    stores: storedText,
    needs: ['vision.shots', 'vision.analyse'],
    appliesTo: ['video', 'image', 'live_photo'],
    priority: 'normal',
    milestone: 'searchable',
    job: (view) => {
      if (view.shots.length === 0) return { skip: OCR_SKIP.noShots };
      const analysed = view.shots.flatMap((s) => (s.analysis ? [{ ...s, analysis: s.analysis }] : []));
      if (analysed.length === 0) return { skip: OCR_SKIP.notAnalysed };
      if (readByAnalysis(view)) return { skip: OCR_SKIP.textRead };
      return stageJob(visionReadShotTextJob, {
        assetId: view.assetId,
        sourceId: view.sourceId,
        path: view.path,
        contentHash: view.contentHash,
        shots: analysed.map((s) => ({
          shotId: s.shotId,
          range: s.range,
          bestFrame: s.analysis.bestFrame,
          ...(s.analysis.onScreenText.length > 0 ? { textTracks: s.analysis.onScreenText.length } : {}),
        })),
        languages: ocrLanguagesFor(view, options),
        ...framesOf(view, preferred),
      });
    },
    result: (output, view) => {
      const read = new Map(
        visionReadShotTextJob.output.parse(output).shots.map((s) => [s.shotId, s.onScreenText]),
      );
      // Into each analysis as stored now; a shot gone or never analysed since the job was built gets nothing.
      const analyses = view.shots.flatMap((shot) => {
        const text = read.get(shot.shotId);
        return shot.analysis && text
          ? [{ shotId: shot.shotId, analysis: { ...shot.analysis, onScreenText: text } }]
          : [];
      });
      return ok({ analyses });
    },
  });
}
