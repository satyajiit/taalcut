// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Handlers for the indexing kinds, registered in the jobs process. */
import {
  err,
  ok,
  registerJob,
  type EmbeddingItemKind,
  type JobContext,
  type JobHandler,
  type JobRegistration,
  type Result,
  type VectorItem,
} from '@taalcut/core';
import type { z } from 'zod';
import { analyzeShots } from '../analysis/analyze-shots';
import { duplicateThresholds, groupNearDuplicates } from '../analysis/duplicates';
import { descriptionDocument } from '../describe/actions';
import { describeShots, describeShotsOverPort, type DescribeShotsOutput } from '../describe/describe-shots';
import { embedAsset, frameItemId } from '../embed/embed-asset';
import { embedAssetTexts } from '../embed/embed-texts';
import { DEFAULT_EMBEDDING_PROFILE } from '../embed/profile';
import { EmbedderUnavailable, VisionModelMissing } from '../errors';
import { detectShots } from '../shots/detect-shots';
import type { FrameSource } from '../media/frame-source';
import type { VisionJobDeps } from './deps';
import { FRAME_CONSUMERS, withAssetFrames } from './frame-jobs';
import { keepShotVectors } from './shot-vectors';
import {
  TEXT_READER,
  VISION_JOB_STAGES,
  type DescribeJobInput,
  type DescribeJobOutput,
  visionAnalyzeShotsJob,
  visionDescribeShotsCloudJob,
  visionDescribeShotsJob,
  visionDetectShotsJob,
  visionEmbedAssetJob,
  visionEmbedTextsJob,
  visionGroupDuplicatesJob,
} from './index-kinds';

function reporter(context: JobContext, stageKey: string) {
  context.progress({ fraction: 0, stageKey });
  return (fraction: number) => context.progress({ fraction: Math.min(1, Math.max(0, fraction)), stageKey });
}

type EmbedAssetJobInput = z.output<typeof visionEmbedAssetJob.input>;
type EmbedAssetJobOutput = z.output<typeof visionEmbedAssetJob.output>;
type EmbedTextsJobInput = z.output<typeof visionEmbedTextsJob.input>;
type EmbedTextsJobOutput = z.output<typeof visionEmbedTextsJob.output>;
type GroupDuplicatesJobInput = z.output<typeof visionGroupDuplicatesJob.input>;
type GroupDuplicatesJobOutput = z.output<typeof visionGroupDuplicatesJob.output>;

const noEmbedder = () =>
  EmbedderUnavailable(undefined, { detail: 'no embedder or vector index in this process' });

/**
 * Stores description vectors (`description:<shotId>`), so a search finds what a shot shows, and drops those of
 * shots that are gone (IX2-C5): `shots` are the asset's current analysed shots, the ones a description can be of.
 */
async function embedDescriptions(
  output: Pick<DescribeShotsOutput, 'descriptions'>,
  input: {
    readonly assetId: string;
    readonly sourceId?: string;
    readonly shots: readonly { shotId: string }[];
  },
  deps: VisionJobDeps,
  signal: AbortSignal,
): Promise<Result<void>> {
  const { embedder, index } = deps;
  if (!index) return ok(undefined);
  const metadata = { assetId: input.assetId, sourceId: input.sourceId ?? null, kind: 'description' as const };
  let items: VectorItem[] = [];
  if (embedder && output.descriptions.length > 0) {
    const vectors = await embedder.embedTexts(
      output.descriptions.map((d) => descriptionDocument(d.description)),
      { purpose: 'document', signal },
    );
    if (!vectors.ok) return vectors;
    items = output.descriptions.flatMap((d, i) => {
      const vector = vectors.value[i];
      return vector ? [{ id: `description:${d.shotId}`, vector, metadata }] : [];
    });
  }
  const kept = keepShotVectors(index, {
    assetId: input.assetId,
    sourceId: metadata.sourceId,
    kind: 'description',
    current: input.shots.map((shot) => `description:${shot.shotId}`),
    items,
  });
  return kept.ok ? ok(undefined) : kept;
}

/** The describe kinds: descriptions over main's port or this process's models, the frames read through the asset's source. */
function describeHandler(
  deps: VisionJobDeps,
  placement: 'local' | 'cloud',
): JobHandler<DescribeJobInput, DescribeJobOutput> {
  return async (input, context) => {
    const progress = reporter(context, VISION_JOB_STAGES.describingShots);
    const shots = { path: input.path, rate: input.rate, shots: input.shots };
    const ctx = { placement, signal: context.signal, progress };
    const settings = deps.settings ? { settings: deps.settings } : {};
    const { background, models } = deps;
    const describe = background
      ? (frames: FrameSource) => describeShotsOverPort(shots, { media: deps.media, frames, background }, ctx)
      : models
        ? (frames: FrameSource) =>
            describeShots(shots, { media: deps.media, frames, models, ...settings }, ctx)
        : undefined;
    if (!describe) {
      const pruned = await embedDescriptions({ descriptions: [] }, input, deps, context.signal);
      return pruned.ok ? ok({ descriptions: [], uploadedTo: [], skipped: 'not_yet' as const }) : pruned;
    }
    const use = { consumer: FRAME_CONSUMERS.describe };
    const described = await withAssetFrames(deps, input, context.signal, use, describe);
    if (!described.ok) return described;
    const result: DescribeShotsOutput = described.value.value;
    // On this Mac, not yet is the model's runtime not being ready: the library holds the stage and tries again.
    if (result.skipped === 'not_yet' && placement === 'local' && deps.describeComponent)
      return err(
        VisionModelMissing(
          { component: deps.describeComponent },
          { detail: 'the on-device describing runtime is not ready yet' },
        ),
      );
    const stored = await embedDescriptions(result, input, deps, context.signal);
    if (!stored.ok) return stored;
    return ok({
      ...result,
      descriptions: [...result.descriptions],
      uploadedTo: [...result.uploadedTo],
      decodes: described.value.decodes,
    });
  };
}

/**
 * The stages that read what the shots pass leaves, so the cache keeps it until each has read it: vision.analyse (the
 * analysis), vision.ocr (the 1 fps frames) when this process has an OCR engine, and vision.embed (the cut-pair frames
 * it embedded) when this process embeds.
 */
function shotsConsumers(deps: VisionJobDeps): string[] {
  const embeds = deps.embedder !== undefined && deps.index !== undefined;
  return [
    FRAME_CONSUMERS.analyse,
    ...(deps.ocr ? [FRAME_CONSUMERS.ocr] : []),
    ...(embeds ? [FRAME_CONSUMERS.embed] : []),
  ];
}

/**
 * What a `vision.embedAsset` job queued before the split (IX-E1, no `replaces`) writes now: frames only. Its texts are
 * a snapshot from when it was queued, and their kinds belong to `vision.embedText`, `vision.embedOcr` and
 * `vision.describe`, which run on the same asset as new stages and usually finish first: replacing every kind would
 * delete or overwrite their vectors (IX-F3).
 */
const PRE_SPLIT_REPLACES: readonly EmbeddingItemKind[] = ['frame'];

/** Frame vectors; the frames through the asset's source (the cut pairs from its cache). */
function embedAssetHandler(deps: VisionJobDeps): JobHandler<EmbedAssetJobInput, EmbedAssetJobOutput> {
  return async (input, context) => {
    const { embedder, index } = deps;
    if (!embedder || !index) return err(noEmbedder());
    const progress = reporter(context, VISION_JOB_STAGES.embedding);
    const use = { consumer: FRAME_CONSUMERS.embed };
    const job = { ...input, replaces: input.replaces ?? PRE_SPLIT_REPLACES };
    const result = await withAssetFrames(deps, input, context.signal, use, (frames) =>
      embedAsset(job, { media: deps.media, embedder, index, frames }, { signal: context.signal, progress }),
    );
    return result.ok ? ok({ ...result.value.value, decodes: result.value.decodes }) : result;
  };
}

/** Transcript vectors: text only, no frames. */
function embedTextsHandler(deps: VisionJobDeps): JobHandler<EmbedTextsJobInput, EmbedTextsJobOutput> {
  return async (input, context) => {
    const { embedder, index } = deps;
    if (!embedder || !index) return err(noEmbedder());
    const progress = reporter(context, VISION_JOB_STAGES.embedding);
    return embedAssetTexts(input, { embedder, index }, { signal: context.signal, progress });
  };
}

/** Near-duplicate groups from the shots' stored best frames. */
function groupDuplicatesHandler(
  deps: VisionJobDeps,
): JobHandler<GroupDuplicatesJobInput, GroupDuplicatesJobOutput> {
  return async (input, context) => {
    reporter(context, VISION_JOB_STAGES.groupingDuplicates);
    const vectors = new Map<string, Float32Array>();
    if (deps.index) {
      const read = deps.index.get(input.shots.map((shot) => frameItemId(shot.shotId, 0)));
      if (!read.ok) return read;
      for (const shot of input.shots) {
        const vector = read.value.get(frameItemId(shot.shotId, 0));
        if (vector) vectors.set(shot.shotId, vector);
      }
    }
    // Stored best frames are at this machine's index budget (the embedder's profile; its default without one).
    const budget = deps.embedder
      ? await deps.embedder.indexImageTokens()
      : DEFAULT_EMBEDDING_PROFILE.imageTokens;
    const thresholds = duplicateThresholds(budget);
    const groups = groupNearDuplicates(input.shots, vectors, thresholds);
    return ok({ groups: groups.map((g) => ({ ...g, shotIds: [...g.shotIds] })) });
  };
}

export function indexJobRegistrations(deps: VisionJobDeps): JobRegistration[] {
  return [
    registerJob(visionDetectShotsJob, async (input, context) => {
      const progress = reporter(context, VISION_JOB_STAGES.detectingShots);
      const use = { expect: shotsConsumers(deps) };
      const result = await withAssetFrames(deps, input, context.signal, use, (frames) =>
        detectShots(
          input.path,
          {
            media: deps.media,
            frames,
            keepOcrFrames: deps.ocr !== undefined,
            ...(deps.passParallel ? { parallel: deps.passParallel } : {}),
            ...(deps.embedder ? { embedder: deps.embedder } : {}),
            ...(deps.boundaryModel ? { boundaryModel: deps.boundaryModel } : {}),
            ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
          },
          { signal: context.signal, progress },
        ),
      );
      if (!result.ok) return result;
      const { detector, backend, frameRate, frameCount, shots, cuts } = result.value.value;
      const decodes = result.value.decodes;
      return ok({
        detector,
        ...(backend ? { backend } : {}),
        frameRate,
        frameCount,
        shots: [...shots],
        cuts: [...cuts],
        decodes,
      });
    }),
    registerJob(visionAnalyzeShotsJob, async (input, context) => {
      const progress = reporter(context, VISION_JOB_STAGES.analysingShots);
      const use = { consumer: FRAME_CONSUMERS.analyse };
      const result = await withAssetFrames(deps, input, context.signal, use, (frames) =>
        analyzeShots(
          { path: input.path, shots: input.shots },
          {
            media: deps.media,
            frames,
            ...(deps.passParallel ? { parallel: deps.passParallel } : {}),
            keepOcrFrames: deps.ocr !== undefined,
            ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
          },
          { signal: context.signal, progress },
        ),
      );
      if (!result.ok) return result;
      // On-screen text is vision.ocr's: the output says so, which tells these analyses from older ones.
      return ok({ shots: result.value.value, text: TEXT_READER, decodes: result.value.decodes });
    }),
    registerJob(visionEmbedAssetJob, embedAssetHandler(deps)),
    registerJob(visionEmbedTextsJob, embedTextsHandler(deps)),
    registerJob(visionDescribeShotsJob, describeHandler(deps, 'local')),
    registerJob(visionDescribeShotsCloudJob, describeHandler(deps, 'cloud')),
    registerJob(visionGroupDuplicatesJob, groupDuplicatesHandler(deps)),
  ];
}
