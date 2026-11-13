// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every vision job kind with its handler, for the jobs process's engine:
 * indexing (shots, analysis, embeddings, descriptions, duplicates) and the
 * breakdown's (cuts, overlays, contact sheets).
 *
 * `createVisionJobs` takes ready deps. `createLazyVisionJobs` takes a
 * resolver run at the first job (FFmpeg is found asynchronously; the
 * embedder's component may be installed later): a failed resolve fails that
 * job with the resolver's error and is tried again at the next one.
 */
import {
  err,
  type TaalcutError,
  type AsyncResult,
  type JobHandler,
  type JobKind,
  type JobRegistration,
} from '@taalcut/core';
import { GradeFailed, LookUnavailable } from '../look/errors';
import {
  createLookJobs,
  visionBakeGradeJob,
  visionMeasureLookJob,
  type LookJobDeps,
} from '../look/grade-jobs';
import { breakdownJobKinds } from './breakdown-kinds';
import { breakdownJobRegistrations } from './breakdown-handlers';
import { registerIndexContactSheetJob, visionIndexContactSheetJob } from './contact-sheet-stage';
import type { VisionJobDeps } from './deps';
import { indexJobKinds } from './index-kinds';
import { indexJobRegistrations } from './index-handlers';
import { ocrJobKinds } from './ocr-kinds';
import { ocrJobRegistrations } from './ocr-handlers';

/** Every vision job kind, in registration order. */
export const visionJobKinds: readonly JobKind<unknown, unknown>[] = [
  ...indexJobKinds,
  visionIndexContactSheetJob,
  ...ocrJobKinds,
  ...breakdownJobKinds,
  visionMeasureLookJob,
  visionBakeGradeJob,
].map((kind) => kind as unknown as JobKind<unknown, unknown>);

function unconfiguredLook(deps: VisionJobDeps): LookJobDeps {
  return {
    frames: {
      sample: async () => err(LookUnavailable(undefined, { detail: 'no frame source' })),
    },
    luts: {
      write: async () => err(GradeFailed(undefined, { detail: 'no grade cache' })),
    },
    ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
  };
}

export function createVisionJobs(deps: VisionJobDeps): JobRegistration[] {
  return [
    ...indexJobRegistrations(deps),
    registerIndexContactSheetJob(deps),
    ...ocrJobRegistrations(deps),
    ...breakdownJobRegistrations(deps),
    ...createLookJobs(deps.look ?? unconfiguredLook(deps)),
  ];
}

export function createLazyVisionJobs(resolve: () => AsyncResult<VisionJobDeps>): JobRegistration[] {
  let handlers: Promise<Map<string, JobHandler<unknown, unknown>> | null> | undefined;
  let failure: TaalcutError | undefined;
  const ready = () => {
    handlers ??= resolve().then((resolved) => {
      if (!resolved.ok) {
        failure = resolved.error;
        handlers = undefined;
        return null;
      }
      return new Map(createVisionJobs(resolved.value).map(({ kind, handler }) => [kind.kind, handler]));
    });
    return handlers;
  };
  return visionJobKinds.map((kind) => ({
    kind,
    handler: async (input, context) => {
      const map = await ready();
      const handler = map?.get(kind.kind);
      if (handler) return handler(input, context);
      // ready() returns null only after storing the resolver's failure.
      return err(failure!);
    },
  }));
}
