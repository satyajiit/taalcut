// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Handlers for the media job kinds, typed with core's JobHandler and bound to
 * a MediaService. The jobs process registers `createMediaJobs(media)` with
 * its engine; media never imports the engine.
 */
import { ok, type JobHandler, type JobProgress } from '@taalcut/core';
import type { ProbeResult } from '../probe/types';
import type { MediaService } from '../service';
import {
  FRAME_JOB_MAX_BYTES,
  MEDIA_JOB_STAGES,
  mediaExtractFrameJob,
  mediaProbeJob,
  mediaSelectEncoderJob,
  type ExtractFrameJobInput,
  type ExtractFrameJobOutput,
  type ProbeJobInput,
  type SelectEncoderJobInput,
} from './kinds';
import { registerJob, type JobRegistration } from './runner';
import { createPhase2Jobs, type Phase2Media } from './phase2-handlers';
import type { EncoderChoice } from '../backends';

export type MediaJobDeps = Pick<MediaService, 'probe' | 'extractFrame' | 'selectEncoder'> &
  Partial<Phase2Media>;

function hasPhase2(media: MediaJobDeps): media is MediaJobDeps & Phase2Media {
  return (
    typeof media.normalise === 'function' &&
    typeof media.makeProxy === 'function' &&
    typeof media.makePreviews === 'function' &&
    typeof media.makeFilmstrip === 'function' &&
    typeof media.conform === 'function' &&
    typeof media.enforceCacheCap === 'function'
  );
}

const stage = (fraction: number | null, stageKey: string): JobProgress => ({ fraction, stageKey });

export function probeJobHandler(media: MediaJobDeps): JobHandler<ProbeJobInput, ProbeResult> {
  return async (input, context) => {
    context.progress(stage(0, MEDIA_JOB_STAGES.probing));
    const result = await media.probe(input.path, { signal: context.signal });
    if (result.ok) context.progress({ fraction: 1 });
    return result;
  };
}

export function extractFrameJobHandler(
  media: MediaJobDeps,
): JobHandler<ExtractFrameJobInput, ExtractFrameJobOutput> {
  return async (input, context) => {
    context.progress(stage(null, MEDIA_JOB_STAGES.extractingFrame));
    const { path, at, ...options } = input;
    const frame = await media.extractFrame(path, at, {
      ...options,
      signal: context.signal,
      maxBytes: FRAME_JOB_MAX_BYTES,
    });
    if (!frame.ok) return frame;
    context.progress({ fraction: 1 });
    const { data, fallbackReason, ...rest } = frame.value;
    return ok({
      ...rest,
      dataBase64: data.toString('base64'),
      ...(fallbackReason ? { fallbackReason } : {}),
    });
  };
}

export function selectEncoderJobHandler(
  media: MediaJobDeps,
): JobHandler<SelectEncoderJobInput, EncoderChoice> {
  return async (input, context) => {
    context.progress(stage(null, MEDIA_JOB_STAGES.testingEncoder));
    return media.selectEncoder(input.codec, { signal: context.signal });
  };
}

/** Every media job kind with its handler, for the jobs process to register. */
export function createMediaJobs(media: MediaJobDeps): readonly JobRegistration[] {
  const jobs: JobRegistration[] = [
    registerJob(mediaProbeJob, probeJobHandler(media)),
    registerJob(mediaExtractFrameJob, extractFrameJobHandler(media)),
    registerJob(mediaSelectEncoderJob, selectEncoderJobHandler(media)),
  ];
  if (hasPhase2(media)) jobs.push(...createPhase2Jobs(media));
  return jobs;
}
