// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render process's worker, for other processes only (never a window):
 * the jobs process runs the `render.export` job through it, and the agent
 * captures frames for the Reviewer and, HFW1, a composition's stills for the
 * Designer. The render process serves it (UTILITY_CONTRACTS.render.worker);
 * main forwards it to the jobs process and the agent
 * (MAIN_SERVICE_CONTRACTS.jobs.render, .agent.render).
 */
import '../basics/zod-config';
import {
  coverImageInputSchema,
  coverImageSchema,
  type CoverImageInput,
  type CoverImage,
} from '../timeline/cover';
import { z } from 'zod';
import { CancelledError, NotImplementedError, ValidationError } from '../basics/errors';
import { idSchema } from '../basics/ids';
import { err, ok, type AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { eventIterator, implementContract, ipc, type RpcClient } from '../ipc/contract';
import { callRpc, fromRpcError, unwrapRpc } from '../ipc/errors';
import { jobRunItemSchema, progressUntil } from '../jobs/job-runner-contract';
import type { JobProgress } from '../jobs/job-types';
import { rationalTimeSchema } from '../time/rational-time';
import { exportPresetIdSchema, rectSchema } from './presets';
import {
  workspaceFramesInputSchema,
  workspaceFramesOutputSchema,
  type WorkspaceFramesInput,
  type WorkspaceFramesOutput,
} from '../workspace/workspace-frames';
import {
  renderExportJobInputSchema,
  renderExportJobOutputSchema,
  type RenderExportJobOutput,
} from './render-types';

export const captureFrameInputSchema = z.object({
  projectId: idSchema<'Project'>(),
  timelineId: idSchema<'Timeline'>(),
  timelineRevision: z.int().positive().optional(),
  frame: z.int().nonnegative(),
  /** 'preview': from proxies, fast. 'render': decoded from a render's file, what the user will see. */
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('preview') }),
    z.object({ kind: z.literal('render'), renderId: idSchema<'Render'>() }),
  ]),
  original: z.boolean().optional(),
  maxDimension: z.int().min(64).max(1920).default(768),
  /** Draw this preset's overlays and safe rect on the frame. */
  overlayPresetId: exportPresetIdSchema.optional(),
});
export type CaptureFrameInput = z.input<typeof captureFrameInputSchema>;

export const textBoxSchema = z.object({
  kind: z.enum(['caption', 'text']),
  id: z.string().min(1).max(64),
  box: rectSchema,
  lines: z.int().nonnegative(),
  inSafeZone: z.boolean(),
});

export const captureFrameOutputSchema = z.object({
  frame: z.int().nonnegative(),
  at: rationalTimeSchema,
  mimeType: z.literal('image/jpeg'),
  /** At most 2 MiB of image. */
  dataBase64: z.string().max(2_796_204),
  width: z.int().positive(),
  height: z.int().positive(),
  visible: z.object({
    clips: z.array(z.string()).max(8),
    captions: z.array(z.string()).max(4),
    texts: z.array(z.string()).max(16),
  }),
  textBoxes: z.array(textBoxSchema).max(32),
});
export type CaptureFrameOutput = z.output<typeof captureFrameOutputSchema>;

export const renderWorkerContract = {
  /** Runs one export: progress items, then `done` with renderExportJobOutputSchema. Abort the call to cancel. */
  export: ipc.input(renderExportJobInputSchema).output(eventIterator(jobRunItemSchema)),
  coverImage: ipc.input(coverImageInputSchema).output(coverImageSchema),
  captureFrame: ipc.input(captureFrameInputSchema).output(captureFrameOutputSchema),
  /** HFW1: stills of a workspace composition over the footage or grey, with the frame checks (workspace-frames.ts). */
  workspaceFrames: ipc.input(workspaceFramesInputSchema).output(workspaceFramesOutputSchema),
};

export interface RenderWorker {
  coverImage?(input: CoverImageInput, options?: { readonly signal?: AbortSignal }): AsyncResult<CoverImage>;
  export(
    input: z.input<typeof renderExportJobInputSchema>,
    options?: { readonly signal?: AbortSignal; readonly onProgress?: (progress: JobProgress) => void },
  ): AsyncResult<RenderExportJobOutput>;
  captureFrame(
    input: CaptureFrameInput,
    options?: { readonly signal?: AbortSignal },
  ): AsyncResult<CaptureFrameOutput>;
  /** HFW1; absent where nothing can draw (core.not_implemented). */
  workspaceFrames?(
    input: WorkspaceFramesInput,
    options?: { readonly signal?: AbortSignal },
  ): AsyncResult<WorkspaceFramesOutput>;
}

export const RenderWorkerToken = createToken<RenderWorker>('core.renderWorker');

/** Serves `worker` from the render process's RenderWorker. */
export function renderWorkerRouter(worker: RenderWorker) {
  const os = implementContract(renderWorkerContract);
  return os.router({
    export: os.export.handler(async function* ({ input, signal }) {
      const result = yield* progressUntil((onProgress) =>
        worker.export(input, { ...(signal ? { signal } : {}), onProgress }),
      );
      yield { type: 'done' as const, output: unwrapRpc(result) };
    }),
    coverImage: os.coverImage.handler(async ({ input, signal }) =>
      unwrapRpc(
        worker.coverImage
          ? await worker.coverImage(input, signal ? { signal } : {})
          : err(NotImplementedError({ feature: 'coverImage' })),
      ),
    ),
    captureFrame: os.captureFrame.handler(async ({ input, signal }) =>
      unwrapRpc(await worker.captureFrame(input, signal ? { signal } : {})),
    ),
    workspaceFrames: os.workspaceFrames.handler(async ({ input, signal }) =>
      unwrapRpc(
        worker.workspaceFrames
          ? await worker.workspaceFrames(input, signal ? { signal } : {})
          : err(NotImplementedError({ feature: 'workspaceFrames' })),
      ),
    ),
  });
}

/** A RenderWorker in another process; resolves the client per call and validates `done`'s output. */
export function renderWorkerOverRpc(client: () => RpcClient<typeof renderWorkerContract>): RenderWorker {
  return {
    async export(input, options = {}) {
      const { signal, onProgress } = options;
      if (signal?.aborted) return err(CancelledError());
      try {
        const stream = await client().export(input, signal ? { signal } : {});
        for await (const item of stream) {
          if (item.type === 'progress') {
            onProgress?.(item.progress);
            continue;
          }
          const output = renderExportJobOutputSchema.safeParse(item.output);
          if (output.success) return ok(output.data);
          return err(ValidationError({ field: 'output' }, { detail: z.prettifyError(output.error) }));
        }
        return err(CancelledError());
      } catch (cause) {
        return err(fromRpcError(cause));
      }
    },
    coverImage: (input, options = {}) =>
      callRpc(client().coverImage(input, options.signal ? { signal: options.signal } : {})),
    captureFrame: (input, options = {}) =>
      callRpc(client().captureFrame(input, options.signal ? { signal: options.signal } : {})),
    workspaceFrames: (input, options = {}) =>
      callRpc(client().workspaceFrames(input, options.signal ? { signal: options.signal } : {})),
  };
}
