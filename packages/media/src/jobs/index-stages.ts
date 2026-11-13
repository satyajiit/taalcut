// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Media's index stages (P2-L13 contract, core `defineIndexStage`): data the
 * library's pipeline runs, so the library never imports media. Names, needs
 * and priorities follow the library SPEC's table: `media.normalise` (plan,
 * facts and, for images that can't be read in place, a still), then
 * `media.thumbnail` (the poster frame, from five seeks: search results have
 * a picture early) at normal priority, `media.proxy` at low priority beside
 * the analysis, then from the proxy once it exists (IX-D4: no second decode of
 * the original) `media.filmstrip` (the scrubber's sprite, UX2) and
 * `media.previews` (the waveform), both low. Later stages
 * read the plan from normalise's stored job output, so each says it reads
 * normalise (and the proxy where it reads it): when either stores something
 * else, they run again (round IX3, dependent invalidation).
 */
import {
  defineIndexStage,
  ok,
  stageJob,
  type AssetIndexView,
  type DerivedFileRef,
  type FrameRate,
  type IndexStageDefinition,
  type TimeRange,
} from '@taalcut/core';
import type { z } from 'zod';
import type { NormalisationPlan } from '../normalise/types';
import {
  makeFilmstripJobOutputSchema,
  makePreviewsJobOutputSchema,
  mediaMakeFilmstripJob,
  mediaMakePreviewsJob,
  mediaMakeProxyJob,
  mediaMakeThumbnailJob,
  mediaNormaliseJob,
  makeThumbnailJobOutputSchema,
  normaliseJobOutputSchema,
  proxyResultSchema,
} from './phase2-kinds';

const STAGE = {
  normalise: 'media.normalise',
  filmstrip: 'media.filmstrip',
  previews: 'media.previews',
  thumbnail: 'media.thumbnail',
  proxy: 'media.proxy',
} as const;

const ONE: FrameRate = { num: 1, den: 1 };
/** The one shot of a photo: its single frame. */
export const PHOTO_SHOT: TimeRange = { start: { value: 0, rate: ONE }, duration: { value: 1, rate: ONE } };

/** Bump to rerun a stage on assets an older version indexed. */
export const MEDIA_STAGE_VERSION = 1;

/** Skip reasons (i18n keys, renderer catalogue). */
export const MEDIA_SKIP = {
  /** normalise finished without a plan to build on (its output wasn't kept). */
  noPlan: 'indexing.skip.noPlan',
} as const;

/** A stage's stored output, when it was kept and still reads with the stage's schema. */
function storedOutput<T>(view: AssetIndexView, stage: string, schema: z.ZodType<T>): T | undefined {
  const parsed = schema.safeParse(view.outputs[stage]);
  return parsed.success ? parsed.data : undefined;
}

/** The plan normalise stored for this asset, if its output was kept. */
export function storedPlan(view: AssetIndexView): NormalisationPlan | undefined {
  return storedOutput(view, STAGE.normalise, normaliseJobOutputSchema)?.plan;
}

/** The proxy file the proxy stage stored (none when the original is its own proxy). */
export function storedProxy(view: AssetIndexView): DerivedFileRef | undefined {
  return storedOutput(view, STAGE.proxy, proxyResultSchema)?.file;
}

/** What normalise stores that later stages read: the plan, the facts and a photo's one shot (round IX3). */
function storedNormalisation(view: AssetIndexView) {
  const photo = view.kind === 'image' ? view.shots.map((shot) => [shot.shotId, shot.range]) : null;
  return { plan: storedPlan(view) ?? null, facts: view.facts, photo };
}

/** The proxy's cache key, when the proxy stage stored one. */
export function storedProxyKey(view: AssetIndexView): string | undefined {
  return storedProxy(view)?.key;
}

/**
 * What the proxy stage stores for its readers: the file's key (content and recipe) and shape, not its size, so a
 * copy made again after the media cache let it go (UX2) reads as the same and its readers don't run again.
 */
function storedProxyShape(view: AssetIndexView) {
  const file = storedProxy(view);
  if (!file) return null;
  const { bytes: _bytes, ...shape } = file;
  return shape;
}

/** The asset, its plan and its proxy, as the stages that read the proxy ask for them. */
function fromProxy(view: AssetIndexView, plan: NormalisationPlan) {
  const proxyKey = storedProxyKey(view);
  return { path: view.path, contentHash: view.contentHash, plan, ...(proxyKey ? { proxyKey } : {}) };
}

/** The poster frame, from a few seeks into the original: search results get a picture early (IX-D4). */
function thumbnailStage(): IndexStageDefinition {
  return defineIndexStage({
    stage: STAGE.thumbnail,
    version: MEDIA_STAGE_VERSION,
    reads: [STAGE.normalise],
    needs: [STAGE.normalise],
    appliesTo: ['video', 'image', 'live_photo'],
    priority: 'normal',
    milestone: 'searchable',
    job: (view) => {
      const plan = storedPlan(view);
      if (!plan) return { skip: MEDIA_SKIP.noPlan };
      return stageJob(mediaMakeThumbnailJob, { path: view.path, contentHash: view.contentHash, plan });
    },
    result: (output) => ok({ derived: [makeThumbnailJobOutputSchema.parse(output).thumbnail] }),
  });
}

/**
 * The scrubber's filmstrip (UX2): one sprite of frames evenly spaced in time, from the proxy (or the original that is
 * its own proxy), with the frames' times in its output, which the asset detail reads.
 */
function filmstripStage(): IndexStageDefinition {
  return defineIndexStage({
    stage: STAGE.filmstrip,
    version: MEDIA_STAGE_VERSION,
    reads: [STAGE.normalise, STAGE.proxy],
    needs: [STAGE.normalise, STAGE.proxy],
    appliesTo: ['video', 'live_photo'],
    // A detail like the waveform: complete-only, after every file is searchable (IX-R2); the clip page asks first.
    priority: 'low',
    milestone: 'complete',
    job: (view) => {
      const plan = storedPlan(view);
      if (!plan) return { skip: MEDIA_SKIP.noPlan };
      return stageJob(mediaMakeFilmstripJob, fromProxy(view, plan));
    },
    result: (output) => ok({ derived: [makeFilmstripJobOutputSchema.parse(output).filmstrip.file] }),
  });
}

/** The waveform, from the proxy once it exists (IX-D4: no second decode of the original). */
function previewsStage(): IndexStageDefinition {
  return defineIndexStage({
    stage: STAGE.previews,
    version: MEDIA_STAGE_VERSION,
    reads: [STAGE.normalise, STAGE.proxy],
    // Videos read the proxy (reused originals have none: they read the file).
    needs: [STAGE.normalise, STAGE.proxy],
    appliesTo: ['video', 'live_photo'],
    // The waveform is a detail: complete-only, after every file is searchable (IX-R2).
    priority: 'low',
    milestone: 'complete',
    job: (view) => {
      const plan = storedPlan(view);
      if (!plan) return { skip: MEDIA_SKIP.noPlan };
      return stageJob(mediaMakePreviewsJob, fromProxy(view, plan));
    },
    result: (output) => {
      const { waveform } = makePreviewsJobOutputSchema.parse(output);
      return ok(waveform ? { derived: [waveform] } : {});
    },
  });
}

export function createMediaIndexStages(): IndexStageDefinition[] {
  const normalise = defineIndexStage({
    stage: STAGE.normalise,
    version: MEDIA_STAGE_VERSION,
    reads: [],
    stores: storedNormalisation,
    needs: ['library.hash'],
    appliesTo: ['video', 'image', 'audio', 'live_photo'],
    priority: 'normal',
    milestone: 'searchable',
    job: (view) =>
      stageJob(mediaNormaliseJob, {
        path: view.path,
        contentHash: view.contentHash,
        sizeBytes: view.sizeBytes,
      }),
    result: (output) => {
      const out = normaliseJobOutputSchema.parse(output);
      return ok({
        facts: out.facts,
        ...(out.still ? { derived: [out.still] } : {}),
        // A photo is one shot of one frame, so vision analyses, embeds and describes it like any shot.
        ...(out.plan.kind === 'image' ? { shots: [PHOTO_SHOT] } : {}),
      });
    },
  });

  const proxy = defineIndexStage({
    stage: STAGE.proxy,
    version: MEDIA_STAGE_VERSION,
    reads: [STAGE.normalise],
    // The proxy file (its key and shape): the filmstrip, the previews and, where the profile reads it, vision's frames.
    stores: storedProxyShape,
    needs: [STAGE.normalise],
    appliesTo: ['video', 'live_photo'],
    priority: 'low',
    milestone: 'complete',
    job: (view) => {
      const plan = storedPlan(view);
      if (!plan) return { skip: MEDIA_SKIP.noPlan };
      return stageJob(mediaMakeProxyJob, {
        path: view.path,
        contentHash: view.contentHash,
        sizeBytes: view.sizeBytes,
        plan,
      });
    },
    // The original is its own proxy when it is already preview-friendly: nothing to store.
    result: (output) => {
      const out = proxyResultSchema.parse(output);
      return ok(out.file ? { derived: [out.file] } : {});
    },
  });

  return [normalise, thumbnailStage(), proxy, filmstripStage(), previewsStage()];
}
