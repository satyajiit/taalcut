// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  agentTurnGroup,
  CommandBusToken,
  err,
  idSchema,
  JobRunnerToken,
  ok,
  RenderStoreToken,
  ValidationError,
  type AsyncResult,
  type CommandToolContext,
  type Container,
  type RenderId,
  type ShortsRequest,
  type ShortsRunId,
  type Timeline,
} from '@taalcut/core';
import { createShortsCache } from '@taalcut/library';
import { renderExportJob } from '@taalcut/render';
import { z } from 'zod';
import { LibraryDatabaseToken } from '../../shared/tokens';

const receiptSchema = z.object({ renderId: idSchema<'Render'>() });
const coverSchema = z.object({ assetId: idSchema<'Asset'>() });

/** Wait for the same durable jobs enqueued by the editor's export command. */
export async function exportShort(
  container: Container,
  runId: ShortsRunId,
  request: ShortsRequest,
  timeline: Timeline,
  ctx: CommandToolContext,
): AsyncResult<{ renderIds: RenderId[]; issues: string[] }> {
  const bus = container.resolve(CommandBusToken);
  const origin = { source: 'agent' as const, actor: `agent:${ctx.runId ?? ctx.callId}` };
  const group = ctx.runId ? { group: agentTurnGroup(ctx.runId) } : {};
  const renderIds: RenderId[] = [];
  const issues: string[] = [];
  for (const [index, presetId] of request.platforms.entries()) {
    const queued = await bus.dispatch(
      'render.export',
      {
        projectId: request.projectId,
        timelineId: timeline.id,
        timelineRevision: timeline.revision,
        presetId,
        rate: timeline.canvas.rate,
        captions: { burnIn: true, sidecars: timeline.captions?.cues.length ? ['srt', 'vtt'] : [] },
        includeBumpers: false,
        notify: false,
      },
      origin,
      { ...group, idempotencyKey: `shorts.export:${runId}:${timeline.revision}:${presetId}` },
    );
    if (!queued.ok) return queued;
    const receipt = receiptSchema.safeParse(queued.value.result);
    if (!receipt.success) return err(ValidationError({ field: 'shorts.exportReceipt' }));
    const renderId = receipt.data.renderId;
    const record = await container.resolve(RenderStoreToken).get(renderId);
    if (!record.ok) return record;
    const done = await container.resolve(JobRunnerToken).run(
      renderExportJob,
      { renderId, request: record.value.request },
      {
        signal: ctx.signal,
        projectId: request.projectId,
        onProgress: (progress) =>
          ctx.reportProgress(
            0.62 +
              ((index + Math.max(0, Math.min(1, progress.fraction ?? 0))) / request.platforms.length) * 0.35,
            progress.stageKey,
          ),
      },
    );
    if (!done.ok) return done;
    renderIds.push(renderId);
    if (done.value.status !== 'ready')
      issues.push(`The ${presetId} export requires review (${done.value.status}).`);
  }
  if (issues.length) return ok({ renderIds, issues });
  const cover = await bus.dispatch(
    'render.exportCover',
    {
      projectId: request.projectId,
      timelineId: timeline.id,
      revision: timeline.revision,
      aspect: '9:16',
    },
    origin,
    { ...group, idempotencyKey: `shorts.cover:${runId}:${timeline.revision}` },
  );
  if (!cover.ok) return cover;
  const parsed = coverSchema.safeParse(cover.value.result);
  if (!parsed.success) return err(ValidationError({ field: 'shorts.coverAsset' }));
  const saved = await createShortsCache(container.resolve(LibraryDatabaseToken)).put(
    `shorts.cover:${runId}`,
    parsed.data,
  );
  return saved.ok ? ok({ renderIds, issues }) : saved;
}
