// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-asset annotated Set-of-Mark contact sheet (`vision.contactSheet` stage,
 * `vision.indexContactSheet` job): builds a 4-column JPEG sheet with `#N · MM:SS.t`
 * badges for every video / Live Photo library item and stores it in the media
 * cache (`stills/…<hash>.contact-sheet.v1.jpg`) so AI tools (`library.getAsset`)
 * and inspectors can see chronological shot progression and trim points at once.
 */
import {
  ASSET_CONTACT_SHEET_MAX_TILES,
  assetContactSheetSchema,
  defineIndexStage,
  defineJobKind,
  err,
  frameRateSchema,
  idSchema,
  ok,
  RationalTime,
  registerJob,
  stageJob,
  type FrameRate,
  type IndexStageDefinition,
  type JobRegistration,
  type ShotId,
  type TimeRange,
} from '@taalcut/core';
import { CacheUnavailable, derivedKey } from '@taalcut/media';
import { z } from 'zod';
import { tileAnnotationsFor } from '../breakdown/contact-sheet';
import type { FrameInput } from '../media/frame-source-policy';
import { fitLongSide } from '../media/frames';
import { composeGrid, encodeJpeg } from '../media/sheet';
import type { VisionJobDeps } from './deps';
import { withAssetFrames } from './frame-jobs';
import { decodes, framed, MINUTE, retry, VISION_JOB_STAGES, visionKey } from './index-kinds';
import { CONTACT_SHEET_VERSION, frameReads, framesOf } from './stage-frames';

export const CONTACT_SHEET_STAGE = 'vision.contactSheet';
export const CONTACT_SHEET_RECIPE = 1;

const SKIP_NO_ANALYSIS = 'indexing.skip.notAnalysed';
const SHEET_COLUMNS = 4;
const SHEET_TILE_LONG_SIDE = 240;
const SHEET_MAX_BYTES = 500_000;
const EXPANDED_MAX_TILES = 24;
const SECONDS_PER_TILE = 1.5;

export interface AnalysedShotForSheet {
  readonly shotId: ShotId;
  readonly range: TimeRange;
  readonly bestFrame: number;
}

export interface PlannedSheetTile {
  readonly frame: number;
  readonly shotId: ShotId;
}

function framesWithinShot(range: TimeRange, bestFrame: number, rate: FrameRate, budget: number): number[] {
  const start = Math.max(0, RationalTime.toFrames(range.start, rate));
  const total = Math.max(1, RationalTime.toFrames(range.duration, rate));
  const best = start + Math.min(total - 1, Math.max(0, bestFrame));
  if (budget <= 1 || total < 2) return [best];
  const count = Math.min(budget, total);
  const anchors = Array.from({ length: count }, (_, i) => {
    const frac = count === 1 ? 0.5 : (i + 0.5) / count;
    return start + Math.min(total - 1, Math.max(0, Math.round((total - 1) * frac)));
  });
  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    const dist = Math.abs(anchors[i]! - best);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }
  anchors[nearestIdx] = best;
  const minGap = Math.max(1, Math.round((rate.num / Math.max(1, rate.den)) * 0.4));
  const sorted = [...new Set(anchors)].sort((a, b) => a - b);
  const kept: number[] = [];
  for (const frame of sorted) {
    if (kept.length === 0 || frame - kept[kept.length - 1]! >= minGap) {
      kept.push(frame);
    } else if (frame === best) {
      kept[kept.length - 1] = frame;
    }
  }
  if (!kept.includes(best)) {
    kept[0] = best;
    kept.sort((a, b) => a - b);
  }
  return kept;
}

/**
 * Picks chronological frames across an asset's shots so single-shot camera takes get multi-point temporal
 * coverage (~1 tile per 1.5 s up to 24 tiles) while multi-shot clips cover every shot's best frame (up to 60).
 */
export function contactSheetTilesForAsset(
  shots: readonly AnalysedShotForSheet[],
  rate: FrameRate,
): PlannedSheetTile[] {
  const ordered = [...shots].sort(
    (a, b) => RationalTime.toFrames(a.range.start, rate) - RationalTime.toFrames(b.range.start, rate),
  );
  if (ordered.length === 0) return [];
  if (ordered.length >= 16) {
    return ordered.slice(0, ASSET_CONTACT_SHEET_MAX_TILES).map((shot) => {
      const start = Math.max(0, RationalTime.toFrames(shot.range.start, rate));
      const total = Math.max(1, RationalTime.toFrames(shot.range.duration, rate));
      return {
        frame: start + Math.min(total - 1, Math.max(0, shot.bestFrame)),
        shotId: shot.shotId,
      };
    });
  }
  const durations = ordered.map((s) => Math.max(0.1, RationalTime.toSeconds(s.range.duration)));
  const rawCounts = durations.map((sec) => Math.max(1, Math.min(12, Math.ceil(sec / SECONDS_PER_TILE))));
  const rawSum = rawCounts.reduce((acc, n) => acc + n, 0);
  const budgets =
    rawSum <= EXPANDED_MAX_TILES
      ? rawCounts
      : rawCounts.map((n) => Math.max(1, Math.floor((n * EXPANDED_MAX_TILES) / rawSum)));
  const planned: PlannedSheetTile[] = [];
  for (let i = 0; i < ordered.length && planned.length < ASSET_CONTACT_SHEET_MAX_TILES; i++) {
    const shot = ordered[i]!;
    const frames = framesWithinShot(shot.range, shot.bestFrame, rate, budgets[i] ?? 1);
    for (const frame of frames) {
      if (planned.length >= ASSET_CONTACT_SHEET_MAX_TILES) break;
      if (planned.length === 0 || planned[planned.length - 1]!.frame !== frame) {
        planned.push({ frame, shotId: shot.shotId });
      }
    }
  }
  return planned;
}

const tileInputSchema = z.object({
  frame: z.int().nonnegative(),
  shotId: idSchema<'Shot'>().optional(),
});

export const visionIndexContactSheetJob = defineJobKind({
  kind: 'vision.indexContactSheet',
  input: z.object({
    ...framed,
    rate: frameRateSchema,
    tiles: z.array(tileInputSchema).min(1).max(ASSET_CONTACT_SHEET_MAX_TILES),
  }),
  output: z.object({
    contactSheet: assetContactSheetSchema,
    ...decodes,
  }),
  resource: 'video',
  priority: 'low',
  retry: retry(2),
  timeoutMs: 10 * MINUTE,
  idempotencyKey: (input) =>
    visionKey(
      'vision.indexContactSheet',
      input,
      JSON.stringify([`sheet-v${CONTACT_SHEET_RECIPE}`, input.tiles]),
    ),
});

export type IndexContactSheetJobInput = z.output<typeof visionIndexContactSheetJob.input>;
export type IndexContactSheetJobOutput = z.output<typeof visionIndexContactSheetJob.output>;

export function registerIndexContactSheetJob(deps: VisionJobDeps): JobRegistration {
  return registerJob(visionIndexContactSheetJob, async (input, context) => {
    context.progress({ fraction: 0, stageKey: VISION_JOB_STAGES.analysingShots });
    if (!input.contentHash || !deps.storeSheet) {
      return err(CacheUnavailable(undefined, { detail: 'no derived cache for contact sheets' }));
    }
    const contentHash = input.contentHash;
    const storeSheet = deps.storeSheet;
    const built = await withAssetFrames(deps, input, context.signal, {}, async (frames) => {
      const last = Math.max(0, (frames.video.frameCount ?? 1) - 1);
      const clamped: { frame: number; shotId?: ShotId }[] = [];
      for (const tile of input.tiles) {
        const frame = Math.min(last, Math.max(0, Math.round(tile.frame)));
        if (clamped.length === 0 || clamped[clamped.length - 1]!.frame !== frame) {
          clamped.push(tile.shotId ? { frame, shotId: tile.shotId } : { frame });
        }
      }
      const columns = Math.max(1, Math.min(SHEET_COLUMNS, clamped.length));
      const size = fitLongSide(frames.video.width, frames.video.height, SHEET_TILE_LONG_SIDE);
      const sampled = await frames.frames(
        { size, format: 'rgb24', frames: clamped.map((t) => t.frame) },
        context.signal,
      );
      if (!sampled.ok) return sampled;
      const byIndex = new Map(sampled.value.map((f) => [f.index, f]));
      const annotations = tileAnnotationsFor(clamped, 'frames', input.rate, true);
      const image = composeGrid(
        clamped.map((t) => byIndex.get(t.frame) ?? null),
        columns,
        size,
        annotations,
        deps.media,
      );
      const encoded = await encodeJpeg(deps.media, image, {
        tempDir: deps.tempDir,
        maxBytes: SHEET_MAX_BYTES,
        signal: context.signal,
      });
      if (!encoded.ok) return encoded;
      const key = derivedKey('still', contentHash, CONTACT_SHEET_RECIPE, 'jpg', 'contact-sheet');
      const stored = await storeSheet(key, encoded.value.jpeg);
      if (!stored.ok) return stored;
      return ok({
        file: {
          kind: 'still' as const,
          key,
          bytes: stored.value.bytes,
          mimeType: 'image/jpeg' as const,
          width: image.width,
          height: image.height,
          frameRate: input.rate,
          recipe: CONTACT_SHEET_RECIPE,
        },
        width: image.width,
        height: image.height,
        columns,
        tileWidth: size.width,
        tileHeight: size.height,
        frameRate: input.rate,
        layout: clamped.map((t, tile) => ({
          tile,
          frame: t.frame,
          at: RationalTime.of(t.frame, input.rate),
          ...(t.shotId ? { shotId: t.shotId } : {}),
        })),
      });
    });
    if (!built.ok) return built;
    context.progress({ fraction: 1, stageKey: VISION_JOB_STAGES.analysingShots });
    return ok({ contactSheet: built.value.value, decodes: built.value.decodes });
  });
}

export function createContactSheetStage(preferred: FrameInput): IndexStageDefinition {
  return defineIndexStage({
    stage: CONTACT_SHEET_STAGE,
    version: CONTACT_SHEET_VERSION,
    reads: ['vision.shots', 'vision.analyse', ...frameReads(preferred)],
    needs: ['vision.analyse'],
    appliesTo: ['video', 'live_photo'],
    priority: 'low',
    milestone: 'complete',
    job: (view) => {
      const analysed = view.shots.filter((s) => s.analysis !== null);
      if (analysed.length === 0) return { skip: SKIP_NO_ANALYSIS };
      const rate = view.facts?.frameRate ?? analysed[0]!.range.start.rate;
      const tiles = contactSheetTilesForAsset(
        analysed.map((s) => ({
          shotId: s.shotId,
          range: s.range,
          bestFrame: s.analysis!.bestFrame,
        })),
        rate,
      );
      if (tiles.length === 0) return { skip: SKIP_NO_ANALYSIS };
      return stageJob(visionIndexContactSheetJob, {
        assetId: view.assetId,
        path: view.path,
        contentHash: view.contentHash,
        rate,
        tiles,
        ...framesOf(view, preferred),
      });
    },
    result: (output) =>
      ok({ derived: [visionIndexContactSheetJob.output.parse(output).contactSheet.file] }),
  });
}
