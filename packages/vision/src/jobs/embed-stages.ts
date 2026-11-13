// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The search-vector stages (P2-L9, split in IX-E1), as core index stages:
 *
 * - `vision.embed`: frame vectors. It needs `vision.analyse` because it
 *   really uses its output: each shot's best frame is `frame:<shotId>:0`
 *   (search and near-duplicates read it). It waits for neither the
 *   transcript nor the on-screen text (`vision.embedOcr`, IX-O5:
 *   ocr-embed-stage.ts).
 * - `vision.embedText`: transcript vectors, after `audio.transcript`. Text
 *   only, no decode, so it is quick whenever the transcript lands.
 *
 * Each replaces only its own item kinds (embed/asset-items.ts), so they can
 * run in either order, and description vectors (`vision.describe`) survive
 * them all. Both count toward the searchable milestone and so run at normal
 * priority (round IX, design C). `vision.embed` reads its frames like the
 * other frame stages (normalise's plan, the proxy where the profile reads
 * it: stage-frames.ts), so the frames shot detection left in the asset's
 * cache are read, not decoded again. Vectors stored by the stages before the split stay searchable until
 * the version bump re-runs `vision.embed` (the same ids are replaced).
 */
import {
  defineIndexStage,
  ok,
  RationalTime,
  stageJob,
  type AssetIndexView,
  type IndexStageDefinition,
  type TimeRange,
} from '@taalcut/core';
import { VISION_CONFIG, type Tier } from '../config';
import type { FrameInput } from '../media/frame-source-policy';
import { visionEmbedAssetJob, visionEmbedTextsJob } from './index-kinds';
import { EMBED_VERSION, frameReads, framesOf } from './stage-frames';
import { measuredCutsSchema } from './stored-parts';

const SKIP_NO_ANALYSIS = 'indexing.skip.notAnalysed';
/**
 * An audio file's `vision.embed` row from before the split (when the stage took transcripts too):
 * the version bump resets it, and it has nothing to do now.
 */
const SKIP_NO_PICTURE = 'indexing.skip.noVideo';
/** No transcript: nothing was said (audio's own reason for a silent clip). */
const SKIP_NO_TRANSCRIPT = 'indexing.skip.silent';

/**
 * `vision.embed`'s stage version: the embed config's (stage-frames.ts `visionStageVersions`). New shots or best
 * frames re-run it through what it reads (round IX3), not through the detector's or the config's version.
 */
export const EMBED_STAGE_VERSION = EMBED_VERSION;

/**
 * Grid frames to embed for one shot, by tier: the best frame (relative to the
 * shot's start) first, then evenly spaced extras, `base + 1 per perSeconds`
 * up to `max` (VISION_CONFIG.embed.framesPerShot).
 *
 * `embedded`: grid frames shot detection already embedded (the frames around
 * each cut it checked). An extra moves onto one within half its spacing, and
 * the best frame onto one at most a frame away, so the embedder's memo hands
 * back their vectors instead of running the model again (IX-E5).
 */
export function framesForShot(
  range: TimeRange,
  bestFrame: number,
  tier: Tier,
  embedded: readonly number[] = [],
): number[] {
  const rule = VISION_CONFIG.embed.framesPerShot[tier];
  const start = range.start.value;
  const length = Math.max(1, range.duration.value);
  const seconds = RationalTime.toSeconds(range.duration);
  const extra = rule.perSeconds > 0 ? Math.floor(seconds / rule.perSeconds) : 0;
  const count = Math.max(1, Math.min(rule.max, rule.base + extra, length));
  const inside = embedded.filter((f) => f >= start && f < start + length);
  const nearest = (target: number, reach: number) =>
    inside
      .filter((f) => Math.abs(f - target) <= reach)
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
  const ideal = start + Math.min(length - 1, Math.max(0, bestFrame));
  const best = nearest(ideal, 1) ?? ideal;
  const spacing = length / (2 * count);
  const extras: number[] = [];
  for (let i = 0; extras.length + 1 < count && i < count; i++) {
    const target = start + Math.floor(((i + 0.5) * length) / count);
    const frame = nearest(target, spacing) ?? target;
    if (![best, ...extras].some((f) => Math.abs(f - frame) < spacing)) extras.push(frame);
  }
  // The best frame stays first: it is `frame:<shotId>:0`, the vector near-duplicates compare.
  return [best, ...extras.sort((a, b) => a - b)];
}

/** Grid frames shot detection embedded: two before and one after each cut it measured (`pairDistances`). */
export function cutPairFrames(view: AssetIndexView): number[] {
  const parsed = measuredCutsSchema.safeParse(view.outputs['vision.shots']);
  if (!parsed.success) return [];
  const last = Math.max(0, parsed.data.frameCount - 1);
  const { before, after } = VISION_CONFIG.cuts;
  return parsed.data.cuts
    .filter((cut) => cut.distance !== undefined)
    .flatMap((cut) => [Math.max(0, cut.frame - before), Math.min(last, cut.frame + after)]);
}

/** The transcript's segments, as `transcript:<assetId>:<n>` items. */
function transcriptTexts(view: AssetIndexView) {
  return (view.transcript?.segments ?? [])
    .map((segment, i) => ({
      itemId: `transcript:${view.assetId}:${i}`,
      kind: 'transcript' as const,
      text: segment.text,
    }))
    .filter((item) => item.text.trim() !== '');
}

export interface EmbedStageOptions {
  /** Read per job: the desktop passes a getter, since the tier is probed later. */
  readonly tier: Tier;
  /** Which file frames are read from (the same as the other vision stages). Default the original. */
  readonly frameInput?: FrameInput;
}

export function createEmbedStages(options: EmbedStageOptions): IndexStageDefinition[] {
  const embed = defineIndexStage({
    stage: 'vision.embed',
    version: EMBED_STAGE_VERSION,
    reads: ['vision.shots', 'vision.analyse', ...frameReads(options.frameInput ?? 'original')],
    needs: ['vision.analyse'],
    appliesTo: ['video', 'image', 'live_photo'],
    milestone: 'searchable',
    priority: 'normal',
    job: (view) => {
      if (view.kind === 'audio') return { skip: SKIP_NO_PICTURE };
      const analysed = view.shots.flatMap((shot) =>
        shot.analysis ? [{ ...shot, analysis: shot.analysis }] : [],
      );
      if (analysed.length === 0) return { skip: SKIP_NO_ANALYSIS, clears: ['frame'] };
      const embedded = cutPairFrames(view);
      return stageJob(visionEmbedAssetJob, {
        assetId: view.assetId,
        sourceId: view.sourceId,
        path: view.path,
        contentHash: view.contentHash,
        frames: analysed.map((shot) => ({
          shotId: shot.shotId,
          frames: framesForShot(shot.range, shot.analysis.bestFrame, options.tier, embedded),
        })),
        // Frames only: the on-screen text vectors are vision.embedOcr's, so they survive a frame re-run.
        texts: [],
        replaces: ['frame'],
        ...framesOf(view, options.frameInput ?? 'original'),
      });
    },
    result: () => ok({}),
  });

  const embedText = defineIndexStage({
    stage: 'vision.embedText',
    version: 1,
    reads: ['audio.transcript'],
    needs: ['audio.transcript'],
    appliesTo: ['video', 'audio', 'live_photo'],
    milestone: 'searchable',
    priority: 'normal',
    job: (view) => {
      // Nothing said (any more): a clip that turned silent loses the transcript vectors an earlier run wrote.
      if (!view.transcript) return { skip: SKIP_NO_TRANSCRIPT, clears: ['transcript'] };
      return stageJob(visionEmbedTextsJob, {
        assetId: view.assetId,
        sourceId: view.sourceId,
        path: view.path,
        contentHash: view.contentHash,
        texts: transcriptTexts(view),
        replaces: ['transcript'],
      });
    },
    result: () => ok({}),
  });

  return [embed, embedText];
}
