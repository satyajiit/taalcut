// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V3, P3-V16: the batch render queue (render.exportBatch, render.cancelBatch) and renders.watchBatch, as
 * @taalcut/render's batch commands answer: every item is checked before any render is queued (an unknown timeline
 * refuses the whole batch), each item becomes one ordinary render.export (the fake renders' own command, so it
 * dedupes and ticks like any export) with its preset and captions from the project's export settings when unset,
 * a draft batch never notifies, the batch id is the caller's (a retry is the same batch), neither is undoable;
 * cancelBatch stops what is queued or running; watchBatch folds the batch's renders, and a batch with none is
 * not found. Over 50 items the payload's schema refuses it, as on the real bus.
 */
import {
  appContract,
  defineCommand,
  err,
  idSchema,
  implementContract,
  NotFoundError,
  ok,
  RENDER_COMMANDS,
  renderCommandPayloads,
  toRpcError,
  ValidationError,
  type AnyCommand,
  type CommandContext,
  type RenderBatchId,
  type RenderId,
  type RenderSnapshot,
} from '@taalcut/core';
import { z } from 'zod';
import { foldBatch } from './batch/batch-fold';
import type { MakeP3Deps } from './deps';

const PROCEDURES = { watchBatch: appContract.renders.watchBatch };
const FINAL = new Set<RenderSnapshot['status']>(['ready', 'needsAttention', 'failed', 'cancelled']);
const queuedSchema = z.object({ renderId: idSchema<'Render'>() });
const exportRequest = renderCommandPayloads[RENDER_COMMANDS.export];

type BatchPayload = z.output<(typeof renderCommandPayloads)[typeof RENDER_COMMANDS.exportBatch]>;

export function createFakeBatch(deps: MakeP3Deps) {
  const batches = new Map<RenderBatchId, RenderId[]>();
  /** Every render.exportBatch payload as it arrived, for the end-to-end tests (taalcutFake.make.p3.batch). */
  const requests: BatchPayload[] = [];
  /** The fake renders' own command (render.export, render.cancel), so a batch's renders are ordinary ones. */
  const run = (name: string, payload: unknown, context: CommandContext) => {
    const found = deps.renders.commands.find((each) => each.name === name);
    return found ? found.handle(payload, context) : err(NotFoundError({ entity: 'command', id: name }));
  };

  /** One item as render.export's request, unset fields from its project's export settings. */
  const requestOf = (payload: BatchPayload, item: BatchPayload['items'][number]) => {
    const options = deps.renders.exportOptions(item.projectId, item.timelineId);
    if (!deps.timelines.get(item.timelineId) || !options)
      return err(NotFoundError({ entity: 'timeline', id: item.timelineId }));
    const request = exportRequest.safeParse({
      projectId: item.projectId,
      timelineId: item.timelineId,
      ...(item.timelineRevision !== undefined ? { timelineRevision: item.timelineRevision } : {}),
      presetId: item.presetId ?? options.defaultPresetId,
      captions: item.captions ?? { burnIn: options.captions.enabled, sidecars: [] },
      // A draft batch is for checking: nothing to announce.
      notify: payload.mode === 'export' && payload.notify,
      batchId: payload.batchId,
    });
    return request.success ? ok(request.data) : err(ValidationError({ field: 'items' }));
  };

  const exportBatch = defineCommand({
    name: RENDER_COMMANDS.exportBatch,
    payload: renderCommandPayloads[RENDER_COMMANDS.exportBatch],
    sideEffect: 'write',
    handle: async (payload, context: CommandContext) => {
      requests.push(payload);
      // Every item checked first, so a bad one refuses the batch before any render is queued.
      const ready = [];
      for (const item of payload.items) {
        const request = requestOf(payload, item);
        if (!request.ok) return request;
        ready.push(request.value);
      }
      const renderIds: RenderId[] = [];
      for (const request of ready) {
        const queued = await run(RENDER_COMMANDS.export, request, context);
        if (!queued.ok) return queued;
        const receipt = queuedSchema.safeParse(queued.value.result);
        if (!receipt.success) return err(ValidationError({ field: 'renderId' }));
        renderIds.push(receipt.data.renderId);
      }
      const known = batches.get(payload.batchId) ?? [];
      batches.set(payload.batchId, [...new Set([...known, ...renderIds])]);
      return ok({ result: { batchId: payload.batchId, renderIds } });
    },
  });

  const cancelBatch = defineCommand({
    name: RENDER_COMMANDS.cancelBatch,
    payload: renderCommandPayloads[RENDER_COMMANDS.cancelBatch],
    sideEffect: 'write',
    handle: async ({ batchId }, context: CommandContext) => {
      const cancelled: RenderId[] = [];
      for (const renderId of batches.get(batchId) ?? []) {
        const render = deps.renders.get(renderId);
        if (!render || FINAL.has(render.status)) continue;
        const done = await run(RENDER_COMMANDS.cancel, { projectId: render.projectId, renderId }, context);
        if (!done.ok) return done;
        cancelled.push(renderId);
      }
      return ok({ result: { batchId, cancelled } });
    },
  });

  const progress = (batchId: RenderBatchId) =>
    foldBatch(
      batchId,
      (batches.get(batchId) ?? []).flatMap((renderId) => deps.renders.get(renderId) ?? []),
    );

  const os = implementContract(PROCEDURES);
  const router = {
    watchBatch: os.watchBatch.handler(async function* ({ input, signal }) {
      if (!batches.has(input.batchId))
        throw toRpcError(NotFoundError({ entity: 'renderBatch', id: input.batchId }));
      for await (const _ of deps.renders.watch(undefined, signal)) yield progress(input.batchId);
    }),
  };
  const commands: AnyCommand[] = [exportBatch, cancelBatch];
  return { router, commands, requests, progress };
}
