// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's `render.exportBatch` (P3-V16, SPEC P3.12): one approval for the whole batch (the exportApproval
 * card in its batch form), then `render.exportBatch` and every render followed to the end, as `render.export`
 * follows one. The jobs queue runs them one after another; cancelling the tool cancels what is still waiting.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  defineTool,
  err,
  exportApprovalCardSchema,
  forwardJobProgress,
  NO_TOOL_RETRY,
  ok,
  qaSummarySchema,
  RENDER_COMMANDS,
  RENDER_STATUSES,
  ulidSchema,
  ValidationError,
  type AsyncResult,
  type Card,
  type CommandToolContext,
  type ProjectId,
  type RenderBatchId,
  type RenderId,
  type TimelineId,
  type ToolCardContext,
} from '@taalcut/core';
import { stableId } from '../ids/stable-id';
import { renderExportJob } from '../jobs/render-jobs';
import { RUNNING_RENDER_STATUSES } from '../store/snapshot';
import { storedRequest } from '../store/stored-request';
import { exportApprovalCard } from '../tools/render-cards';
import type { RenderToolDeps } from '../tools/tool-deps';
import { parsedAs } from '../validate';
import type { BatchReceipt } from './batch-commands';

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const itemSchema = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  timelineRevision: z.int().positive().describe('The reviewed revision of that timeline'),
});

const inputSchema = z.object({
  items: z.array(itemSchema).min(1).max(50),
  mode: z.enum(['export', 'draft']).describe("'draft' checks every timeline without delivering"),
});

const outputSchema = z.object({
  batchId: ulidSchema('RenderBatch'),
  renders: z.array(
    z.object({
      renderId: ulidSchema('Render'),
      status: z.enum(RENDER_STATUSES),
      qa: qaSummarySchema.nullable(),
    }),
  ),
});

type Input = z.output<typeof inputSchema>;

/** The batch's id: the same items and revisions are the same batch (a retry). */
function batchIdOf(input: Input) {
  return stableId<'RenderBatch'>(`render.exportBatch:${sha256(input)}`);
}

async function batchApproval(
  deps: RenderToolDeps,
  input: Input,
  ctx: ToolCardContext & { readonly approvalId: string },
): AsyncResult<Card> {
  const batchId = batchIdOf(input);
  if (!batchId.ok) return batchId;
  const first = input.items[0];
  if (!first) return err(ValidationError({ field: 'items' }));
  const card = await exportApprovalCard(
    deps,
    {
      projectId: first.projectId as ProjectId,
      timelineId: first.timelineId as TimelineId,
      timelineRevision: first.timelineRevision,
    },
    ctx,
  );
  if (!card.ok) return card;
  return parsedAs(
    exportApprovalCardSchema,
    {
      ...card.value,
      id: `exportApproval:${ctx.toolCallId}`,
      batch: { batchId: batchId.value, items: input.items.length },
    },
    'card',
  );
}

/** Every render of the batch followed to its end; the fraction is the mean of theirs. */
async function followAll(deps: RenderToolDeps, renderIds: readonly RenderId[], ctx: CommandToolContext) {
  const fractions = new Map<RenderId, number>();
  const report = () =>
    ctx.reportProgress(
      [...fractions.values()].reduce((sum, value) => sum + value, 0) / Math.max(1, renderIds.length),
    );
  await Promise.all(
    renderIds.map(async (renderId) => {
      const record = await deps.store.get(renderId);
      const request = record.ok ? storedRequest(record.value) : record;
      if (!record.ok || !request.ok || !deps.jobs || !RUNNING_RENDER_STATUSES.has(record.value.status)) {
        fractions.set(renderId, 1);
        return;
      }
      await deps.jobs.run(
        renderExportJob,
        { renderId, request: request.value },
        {
          signal: ctx.signal,
          projectId: record.value.projectId,
          onProgress: forwardJobProgress((fraction) => {
            fractions.set(renderId, fraction ?? 0);
            report();
          }),
        },
      );
      fractions.set(renderId, 1);
      report();
    }),
  );
}

export function renderBatchTool(deps: RenderToolDeps) {
  return defineTool({
    name: 'render.exportBatch',
    version: '1.0.0',
    description: 'Renders several timelines in one queue, one after another, with QA on each.',
    summary: 'Renders several timelines in one queue, after one approval.',
    tags: ['export', 'render', 'batch', 'queue'],
    input: inputSchema,
    output: outputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: RENDER_COMMANDS.exportBatch,
    checkpoint: true,
    timeoutMs: 4 * 60 * 60_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library', 'project'], write: ['app-data'] }, network: 'none' },
    idempotencyKey: (input) => sha256(['render.exportBatch', input.items, input.mode]),
    approvalCard: (input, ctx) => batchApproval(deps, input, ctx),
    summarize: (output) =>
      `Batch ${output.batchId}: ${output.renders.filter((render) => render.status === 'ready').length} of ` +
      `${output.renders.length} ready`,
    run: async (input, ctx) => {
      const batchId = batchIdOf(input);
      if (!batchId.ok) return batchId;
      const dispatched = await ctx.dispatch({
        batchId: batchId.value,
        items: input.items,
        mode: input.mode,
        notify: false,
      });
      if (!dispatched.ok) return dispatched;
      const receipt = dispatched.value as BatchReceipt;
      await followAll(deps, receipt.renderIds, ctx);
      const renders = [];
      for (const renderId of receipt.renderIds) {
        const record = await deps.store.get(renderId);
        if (!record.ok) return record;
        renders.push({ renderId, status: record.value.status, qa: record.value.qa });
      }
      return ok({ batchId: batchId.value as RenderBatchId, renders });
    },
  });
}
