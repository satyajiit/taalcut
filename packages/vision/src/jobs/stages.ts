// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Vision's index stages (P2-L13 contract, core `defineIndexStage`): data the
 * library's pipeline runs, so the library never imports vision. Names and
 * order follow the library SPEC's table: vision.shots → vision.analyse →
 * vision.ocr (on-screen text; ocr-stages.ts) → vision.embedOcr (its vectors;
 * ocr-embed-stage.ts); vision.embed (frames) and vision.embedText
 * (transcript, after audio.transcript; embed-stages.ts); vision.describe
 * (after vision.analyse), plus the library-wide near-duplicate pass after
 * analyses settle.
 */
import {
  defineIndexStage,
  ok,
  PLACE_STAGE,
  RationalTime,
  stageJob,
  type AssetIndexView,
  type DuplicatePassDefinition,
  type FrameRate,
  type IndexStageDefinition,
  type ShotAnalysis,
  type ShotId,
  type TimeRange,
} from '@taalcut/core';
import type { FrameInput } from '../media/frame-source-policy';
import type { z } from 'zod';
import { VISION_CONFIG, type Tier } from '../config';
import type { VisionPlacement } from '../describe/placement';
import { withShotContext } from '../describe/shot-context';
import {
  visionAnalyzeShotsJob,
  visionDescribeShotsCloudJob,
  visionDescribeShotsJob,
  visionDetectShotsJob,
  visionGroupDuplicatesJob,
} from './index-kinds';
import { createContactSheetStage } from './contact-sheet-stage';
import { createEmbedStages } from './embed-stages';
import { createEmbedOcrStage } from './ocr-embed-stage';
import { createOcrStage, withStoredText, type OcrStageOptions } from './ocr-stages';
import { ANALYSE_VERSION, DESCRIBE_VERSION, frameReads, framesOf, SHOTS_VERSION } from './stage-frames';
import { storedAnalyses, storedShots, withStoredDescriptions } from './stored-parts';

export interface VisionStageOptions extends OcrStageOptions {
  readonly tier: Tier;
  /** Where descriptions run now: 'local' with an on-device vision model, else 'cloud' (consent-gated). */
  readonly placement: () => VisionPlacement;
  /** Which file the analysis decodes, by hardware profile (frame-source-policy.ts). Default the original. */
  readonly frameInput?: FrameInput;
}

const SKIP_NO_SHOTS = 'indexing.skip.noShots';
const SKIP_NO_ANALYSIS = 'indexing.skip.notAnalysed';

/** A shot's first frame on the asset's grid and its length in frames. */
function shotSpan(range: TimeRange, rate: FrameRate): { start: number; length: number } {
  return {
    start: Math.max(0, RationalTime.toFrames(range.start, rate)),
    length: Math.max(1, RationalTime.toFrames(range.duration, rate)),
  };
}

/**
 * MOM1: the grid frames the describer sees for one shot, in order (VISION_CONFIG.describe.moments, by tier). A shot
 * under `minSeconds` is its best frame alone. A longer one is a frame per `strideSeconds`, at least two and at most
 * `maxFrames`, each at the middle of an equal part of the shot: a frame stands for the stretch around it, which is
 * what the shot's moments are read from.
 */
export function describeFramesForShot(
  range: TimeRange,
  bestFrame: number,
  rate: FrameRate,
  tier: Tier = 'recommended',
): number[] {
  const { start, length } = shotSpan(range, rate);
  const rule = VISION_CONFIG.describe.moments;
  const seconds = RationalTime.toSeconds(range.duration);
  const { strideSeconds, maxFrames } = rule.frames[tier];
  const count =
    seconds < rule.minSeconds
      ? 1
      : Math.min(maxFrames, length, Math.max(2, Math.ceil(seconds / strideSeconds)));
  if (count < 2) return [start + Math.min(length - 1, Math.max(0, bestFrame))];
  const frames = Array.from(
    { length: count },
    (_, part) => start + Math.min(length - 1, Math.floor(((part + 0.5) * length) / count)),
  );
  return [...new Set(frames)];
}

function shotsOf(
  view: AssetIndexView,
): { shotId: ShotId; range: TimeRange; analysis: ShotAnalysis | null }[] {
  return [...view.shots];
}

export function createVisionIndexStages(options: VisionStageOptions): IndexStageDefinition[] {
  const preferred = options.frameInput ?? 'original';
  const shots = defineIndexStage({
    stage: 'vision.shots',
    version: SHOTS_VERSION,
    reads: frameReads(preferred),
    stores: storedShots,
    // Reading the proxy waits for it (videos only: an image's proxy stage doesn't apply).
    needs: preferred === 'proxy' ? ['media.normalise', 'media.proxy'] : ['media.normalise'],
    appliesTo: ['video', 'live_photo'],
    priority: 'normal',
    milestone: 'searchable',
    job: (view) =>
      stageJob(visionDetectShotsJob, {
        assetId: view.assetId,
        path: view.path,
        contentHash: view.contentHash,
        ...framesOf(view, preferred),
      }),
    result: (output) => ok({ shots: (output as z.output<typeof visionDetectShotsJob.output>).shots }),
  });

  const analyse = defineIndexStage({
    stage: 'vision.analyse',
    version: ANALYSE_VERSION,
    // A photo's one shot is normalise's.
    reads: ['vision.shots', ...frameReads(preferred)],
    stores: storedAnalyses,
    needs: ['vision.shots'],
    appliesTo: ['video', 'image', 'live_photo'],
    priority: 'normal',
    milestone: 'searchable',
    job: (view) => {
      if (view.shots.length === 0) return { skip: SKIP_NO_SHOTS };
      // On-screen text is vision.ocr's (IX-O5): the analysis reads none.
      return stageJob(visionAnalyzeShotsJob, {
        assetId: view.assetId,
        path: view.path,
        contentHash: view.contentHash,
        shots: shotsOf(view).map((s) => ({ shotId: s.shotId, range: s.range })),
        ...framesOf(view, preferred),
      });
    },
    result: (output, view) => {
      const known = new Map(view.shots.map((s) => [s.shotId as string, s.shotId]));
      const analyses = (output as z.output<typeof visionAnalyzeShotsJob.output>).shots.flatMap((s) => {
        const shotId = known.get(s.shotId);
        return shotId ? [{ shotId, analysis: s.analysis }] : [];
      });
      // A re-run keeps what vision.ocr and vision.describe stored for shots that didn't move: they run again only
      // when what the analysis stores changes (dependent invalidation).
      return ok({ analyses: withStoredDescriptions(view, withStoredText(view, analyses)) });
    },
  });

  const describe = defineIndexStage({
    stage: 'vision.describe',
    version: DESCRIBE_VERSION,
    reads: ['vision.shots', 'vision.analyse', ...frameReads(preferred)],
    // The transcript and the on-screen text go to the describer with each frame (LRN1-CTX), and so does where the
    // clip was filmed (place's `library.place`, read from the view's outputs by the shot context). Waited for while
    // they are coming, never while their model is missing or they failed: a description doesn't wait on a speech
    // model the user doesn't have, and is made again once they land (core `optionalReads`).
    optionalReads: ['vision.ocr', 'audio.transcript', PLACE_STAGE],
    // It needed vision.embed only for ordering; the best frames it describes come from the analysis.
    needs: ['vision.analyse'],
    appliesTo: ['video', 'image', 'live_photo'],
    priority: 'low',
    milestone: 'complete',
    job: (view) => {
      const analysed = shotsOf(view).filter((s) => s.analysis !== null);
      if (analysed.length === 0) return { skip: SKIP_NO_ANALYSIS, clears: ['description', 'moment'] };
      const rate = view.facts?.frameRate ?? analysed[0]!.range.start.rate;
      const kind = options.placement() === 'local' ? visionDescribeShotsJob : visionDescribeShotsCloudJob;
      return stageJob(kind, {
        assetId: view.assetId,
        path: view.path,
        contentHash: view.contentHash,
        rate,
        shots: withShotContext(
          view,
          analysed.map((s) => {
            const frame = RationalTime.toFrames(s.range.start, rate) + s.analysis!.bestFrame;
            const frames = describeFramesForShot(s.range, s.analysis!.bestFrame, rate, options.tier);
            return {
              shotId: s.shotId,
              frame,
              // MOM1: with the shot's span, the describer knows each frame's time and answers its moments.
              ...(frames.length > 1 ? { frames, span: shotSpan(s.range, rate) } : {}),
            };
          }),
          rate,
        ),
        ...framesOf(view, preferred),
      });
    },
    result: (output, view) => {
      const out = output as z.output<typeof visionDescribeShotsJob.output>;
      if (out.skipped) {
        // Say why on every shot without a description, so the library and the UI can tell "not yet" from "not
        // allowed"; a description the shot has stays, with no reason beside it (IX3-F5, L1).
        const reason = out.skipped;
        return ok({
          analyses: view.shots
            .filter((s) => s.analysis)
            .map((s) => ({
              shotId: s.shotId,
              analysis: s.analysis!.description
                ? s.analysis!
                : { ...s.analysis!, descriptionSkipped: reason },
            })),
        });
      }
      const known = new Map(view.shots.map((s) => [s.shotId as string, s.shotId]));
      return ok({
        descriptions: out.descriptions
          .filter((d) => known.has(d.shotId))
          .map((d) => ({ shotId: known.get(d.shotId)!, description: d.description })),
      });
    },
  });

  return [
    shots,
    analyse,
    createOcrStage(options, preferred),
    createEmbedOcrStage(),
    ...createEmbedStages(options),
    createContactSheetStage(preferred),
    describe,
  ];
}

/** The library-wide near-duplicate pass (G25), after analyses settle. */
export const visionDuplicatePass: DuplicatePassDefinition = {
  after: ['vision.analyse'],
  job: (shots) =>
    stageJob(visionGroupDuplicatesJob, {
      shots: shots.map((shot) => ({
        shotId: shot.shotId,
        assetId: shot.assetId,
        sourceId: shot.sourceId,
        capturedAt: shot.capturedAt,
        durationMs: Math.round(RationalTime.toSeconds(shot.range.duration) * 1000),
        overall: shot.analysis.quality.overall,
        dHash: shot.analysis.dHash,
        orientation: shot.analysis.orientation,
      })),
    }),
  groups: (output) =>
    ok(
      (output as z.output<typeof visionGroupDuplicatesJob.output>).groups.map((group) => ({
        shotIds: group.shotIds as ShotId[],
        bestShotId: group.bestShotId as ShotId,
      })),
    ),
};
