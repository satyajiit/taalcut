// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Handlers for the Phase 2 job kinds. They report a stage and call the
 * service; they do not run FFmpeg themselves.
 */
import { ok, type JobHandler } from '@taalcut/core';
import { createDecodeTally } from '../decode-count/tally';
import type { RunOptions } from './operate';
import {
  PHASE2_STAGES,
  mediaConformJob,
  mediaEnforceCacheCapJob,
  mediaMakeFilmstripJob,
  mediaMakePreviewsJob,
  mediaMakeProxyJob,
  mediaMakeThumbnailJob,
  mediaNormaliseJob,
  type ConformJobInput,
  type ConformJobOutput,
  type EnforceCacheCapJobInput,
  type EnforceCacheCapJobOutput,
  type MakeFilmstripJobInput,
  type MakeFilmstripJobOutput,
  type MakePreviewsJobInput,
  type MakePreviewsJobOutput,
  type MakeProxyJobInput,
  type MakeThumbnailJobInput,
  type MakeThumbnailJobOutput,
  type NormaliseJobInput,
  type NormaliseJobOutput,
  type ProxyJobOutput,
} from './phase2-kinds';
import { registerJob, type JobRegistration } from './runner';

export interface Phase2Media {
  normalise(
    input: NormaliseJobInput & RunOptions,
  ): Promise<Awaited<ReturnType<JobHandler<NormaliseJobInput, NormaliseJobOutput>>>>;
  makeProxy(
    input: MakeProxyJobInput & RunOptions,
  ): Promise<Awaited<ReturnType<JobHandler<MakeProxyJobInput, ProxyJobOutput>>>>;
  makePreviews(
    input: MakePreviewsJobInput & RunOptions,
  ): Promise<Awaited<ReturnType<JobHandler<MakePreviewsJobInput, MakePreviewsJobOutput>>>>;
  makeFilmstrip(
    input: MakeFilmstripJobInput & RunOptions,
  ): Promise<Awaited<ReturnType<JobHandler<MakeFilmstripJobInput, MakeFilmstripJobOutput>>>>;
  makeThumbnail(
    input: MakeThumbnailJobInput & RunOptions,
  ): Promise<Awaited<ReturnType<JobHandler<MakeThumbnailJobInput, Omit<MakeThumbnailJobOutput, 'decodes'>>>>>;
  conform(
    input: ConformJobInput & RunOptions,
  ): Promise<Awaited<ReturnType<JobHandler<ConformJobInput, ConformJobOutput>>>>;
  enforceCacheCap(
    input: EnforceCacheCapJobInput,
  ): Promise<Awaited<ReturnType<JobHandler<EnforceCacheCapJobInput, EnforceCacheCapJobOutput>>>>;
}

export function createPhase2Jobs(media: Phase2Media): readonly JobRegistration[] {
  const normalise: JobHandler<NormaliseJobInput, NormaliseJobOutput> = async (input, context) => {
    context.progress({ fraction: 0, stageKey: PHASE2_STAGES.normalising });
    const tally = createDecodeTally(input.path);
    const result = await media.normalise({ ...input, signal: context.signal, tally });
    if (!result.ok) return result;
    context.progress({ fraction: 1 });
    return ok({ ...result.value, decodes: tally.snapshot() });
  };
  const makeProxy: JobHandler<MakeProxyJobInput, ProxyJobOutput> = async (input, context) => {
    context.progress({ fraction: 0, stageKey: PHASE2_STAGES.makingProxy });
    const tally = createDecodeTally(input.path);
    const result = await media.makeProxy({ ...input, signal: context.signal, tally });
    if (!result.ok) return result;
    context.progress({ fraction: 1 });
    return ok({ ...result.value, decodes: tally.snapshot() });
  };
  const makePreviews: JobHandler<MakePreviewsJobInput, MakePreviewsJobOutput> = async (input, context) => {
    context.progress({ fraction: 0, stageKey: PHASE2_STAGES.makingPreviews });
    const tally = createDecodeTally(input.path);
    const result = await media.makePreviews({ ...input, signal: context.signal, tally });
    if (!result.ok) return result;
    context.progress({ fraction: 1 });
    return ok({ ...result.value, decodes: tally.snapshot() });
  };
  const makeFilmstrip: JobHandler<MakeFilmstripJobInput, MakeFilmstripJobOutput> = async (input, context) => {
    context.progress({ fraction: 0, stageKey: PHASE2_STAGES.makingFilmstrip });
    const tally = createDecodeTally(input.path);
    const result = await media.makeFilmstrip({ ...input, signal: context.signal, tally });
    if (!result.ok) return result;
    context.progress({ fraction: 1 });
    return ok({ ...result.value, decodes: tally.snapshot() });
  };
  const makeThumbnail: JobHandler<MakeThumbnailJobInput, MakeThumbnailJobOutput> = async (input, context) => {
    // "Making thumbnails": the renderer's words for previews fit the poster frame too.
    context.progress({ fraction: 0, stageKey: PHASE2_STAGES.makingPreviews });
    const tally = createDecodeTally(input.path);
    const result = await media.makeThumbnail({ ...input, signal: context.signal, tally });
    if (!result.ok) return result;
    context.progress({ fraction: 1 });
    return ok({ ...result.value, decodes: tally.snapshot() });
  };
  const conform: JobHandler<ConformJobInput, ConformJobOutput> = async (input, context) => {
    context.progress({ fraction: 0, stageKey: PHASE2_STAGES.conforming });
    const result = await media.conform({ ...input, signal: context.signal });
    if (result.ok) context.progress({ fraction: 1 });
    return result;
  };
  const enforce: JobHandler<EnforceCacheCapJobInput, EnforceCacheCapJobOutput> = async (input, context) => {
    context.progress({ fraction: 0, stageKey: PHASE2_STAGES.enforcingCacheCap });
    const result = await media.enforceCacheCap(input);
    if (result.ok) context.progress({ fraction: 1 });
    return result;
  };
  return [
    registerJob(mediaNormaliseJob, normalise),
    registerJob(mediaMakeProxyJob, makeProxy),
    registerJob(mediaMakePreviewsJob, makePreviews),
    registerJob(mediaMakeFilmstripJob, makeFilmstrip),
    registerJob(mediaMakeThumbnailJob, makeThumbnail),
    registerJob(mediaConformJob, conform),
    registerJob(mediaEnforceCacheCapJob, enforce),
  ];
}
