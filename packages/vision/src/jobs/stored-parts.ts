// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What vision's read stages store that later stages read (round IX3, dependent invalidation): their definitions'
 * `stores`, taken from the asset's view once their result is stored. The library keeps a digest of each per asset
 * and re-runs the stages that read one when a run changes it. Each holds only what its readers read, so a re-run
 * that changes something no stage reads (casting's curves, a text's box, a cut's score) re-runs nothing; the
 * desktop's `index-stage-reads.test.ts` checks that no stage reads a part of the view its read stages leave out.
 */
import { TimeRange, type AssetIndexView, type ShotAnalysis, type ShotId } from '@taalcut/core';
import { z } from 'zod';
import { VISION_CONFIG } from '../config';
import { isStill } from '../describe/actions';

/** What `vision.embed` reads of shot detection's stored output: the cuts it checked with embeddings. */
export const measuredCutsSchema = z.object({
  frameCount: z.int().nonnegative(),
  cuts: z.array(z.object({ frame: z.int().nonnegative(), distance: z.number().optional() })),
});

/**
 * `vision.shots`: each shot's id and range, and the cuts it measured (`vision.embed`'s cut pairs) with the frames
 * around each it embedded (`VISION_CONFIG.cuts`, which `vision.embed` reads them back by: a change there comes with a
 * `VISION_CONFIG.version` rise that re-runs detection, and now changes this too).
 */
export function storedShots(view: AssetIndexView) {
  const measured = measuredCutsSchema.safeParse(view.outputs['vision.shots']);
  return {
    shots: view.shots.map((shot) => [shot.shotId, shot.range]),
    measured: measured.success
      ? {
          frameCount: measured.data.frameCount,
          cuts: measured.data.cuts.map((cut) => [cut.frame, cut.distance ?? null]),
          pairs: [VISION_CONFIG.cuts.before, VISION_CONFIG.cuts.after],
        }
      : null,
  };
}

const textReader = z.object({ text: z.string().optional() });

/**
 * `vision.analyse`: each shot's best frame (null while it has no analysis), which `vision.ocr`, `vision.embed` and
 * `vision.describe` read; the shots nothing moves in (LIB1-FIND: `vision.describe` drops their motion words), as
 * the gate's result, not the raw energy, so a re-analysis re-describes a shot only when its gate flips; and whether
 * its output names the stage that reads on-screen text (`vision.ocr` skips an analysis that read its text itself).
 */
export function storedAnalyses(view: AssetIndexView) {
  const output = view.outputs['vision.analyse'];
  const reader = textReader.safeParse(output);
  return {
    output: output === undefined ? 'none' : reader.success ? (reader.data.text ?? 'analysis') : 'unread',
    bestFrames: view.shots.map((shot) => [shot.shotId, shot.analysis?.bestFrame ?? null]),
    stills: view.shots.filter(isStill).map((shot) => shot.shotId),
  };
}

/** `vision.ocr`: the words on each shot that shows any, in order: `vision.embedOcr`'s items. */
export function storedText(view: AssetIndexView) {
  return view.shots.flatMap((shot) => {
    const words = (shot.analysis?.onScreenText ?? []).map((text) => text.text);
    return words.length > 0 ? [[shot.shotId, words]] : [];
  });
}

/**
 * New analyses with what later stages stored in them before (dependent invalidation keeps them while their input
 * holds): the description of a shot whose range and best frame didn't move, or why it has none. Had either moved,
 * the analysis's digest changed and `vision.describe` runs again.
 */
export function withStoredDescriptions(
  view: AssetIndexView,
  analyses: readonly { readonly shotId: ShotId; readonly analysis: ShotAnalysis }[],
): { shotId: ShotId; analysis: ShotAnalysis }[] {
  const stored = new Map(view.shots.map((shot) => [shot.shotId, shot.analysis]));
  return analyses.map(({ shotId, analysis }) => {
    const before = stored.get(shotId);
    const same =
      before !== null &&
      before !== undefined &&
      before.bestFrame === analysis.bestFrame &&
      TimeRange.equals(before.range, analysis.range);
    if (!same || (before.description === undefined && before.descriptionSkipped === undefined))
      return { shotId, analysis };
    // A shot has a description or a reason it has none, never both: the fresh "not yet" goes (IX3-F5, L1).
    const { descriptionSkipped: _fresh, ...fresh } = analysis;
    const kept = before.description
      ? { description: before.description }
      : before.descriptionSkipped
        ? { descriptionSkipped: before.descriptionSkipped }
        : {};
    return { shotId, analysis: { ...fresh, ...kept } };
  });
}
