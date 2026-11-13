// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's render tools (SPEC section 11). `render.export` is the run's
 * milestone: it asks with the exportApproval card, then dispatches the
 * command with the project's export settings (which the card may have
 * changed) and follows the job with the same idempotency key, so the tool
 * shares the queued job and cancelling the tool cancels the render.
 */
import { coverExportTool } from '../cover/cover-tool';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  artifactRefSchema,
  defineTool,
  defineToolModule,
  err,
  exportVideoCodecSchema,
  FrameRate,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  platformSchema,
  qaSummarySchema,
  RENDER_COMMANDS,
  renderCredentialsSchema,
  renderCaptionsSchema,
  type ProjectId,
  type RenderId,
  type RenderRecord,
  type TimelineId,
  type ToolModule,
  ulidSchema,
} from '@taalcut/core';
import { renderBatchTool } from '../batch/batch-tool';
import type { RenderToolDeps } from './tool-deps';
import { disclosuresFor, inventoryOf } from '../credentials';
import { listPresetsTool } from './preset-tools';
import { agentPresetIdSchema } from '../presets/presets.v1';
import { exportSettingsSchema } from '../settings';
import { renderDraftTool } from './draft-tool';
import { dispatchAndFollow, exportOutput, exportOutputSchema, reportArtifact } from './export-follow';
import { exportApprovalCard, renderProgressCard } from './render-cards';
import { failingCheckSchema, failingChecks, rateSchema, toolRenderSchema, toToolRender } from './schemas';

export type { RenderToolDeps } from './tool-deps';

const READ_RETRY = { maxAttempts: 2, initialDelayMs: 500 };

/** render.export 2.1.0: whether credentials were added (and their state), and who asks for an AI disclosure. */
const exportToolOutputSchema = exportOutputSchema.extend({
  credentials: renderCredentialsSchema,
  disclosures: z.array(platformSchema),
});

/** The render's credentials, and the platforms whose disclosure applies to its timeline revision. */
async function credentialsOutput(deps: RenderToolDeps, record: RenderRecord) {
  const timeline = deps.timelines.atRevision
    ? await deps.timelines.atRevision(record.timelineId, record.timelineRevision)
    : await deps.timelines.get(record.timelineId);
  const disclosures = timeline.ok ? disclosuresFor(await inventoryOf(timeline.value, deps.provenance)) : [];
  return { credentials: record.credentials, disclosures };
}
const LOCAL_PERMISSION = { network: 'none' } as const;
const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function renderToolModule(deps: RenderToolDeps): ToolModule {
  const get = (renderId: string) => deps.store.get(renderId as RenderId);

  const exportTool = defineTool({
    name: 'render.export',
    version: '2.1.0',
    summary: 'Exports the timeline as a QA-checked video file, after the user approves the export.',
    description:
      'Exports the timeline as one video with the project export settings (preset, codec and captions, which ' +
      'render.setExportPreset sets), after the user approves on the export card. Waits for the render ' +
      'and its QA checks, and returns the render, the failing checks with their fixes and the QA report. ' +
      // Kept short: these words also rank the tool in search, and must not pull it into unrelated asks.
      'timelineRevision is the reviewed revision (from the Editor or render.listPresets); a changed timeline ' +
      'is refused with core.conflict. ' +
      'rate requests an output frame rate; omit it to use the timeline frame rate. ' +
      'Set supersedes to the previous render when exporting again after QA fixes.',
    tags: ['export', 'render', 'video', 'qa'],
    input: z.object({
      projectId: ulidSchema('Project'),
      timelineId: ulidSchema('Timeline'),
      timelineRevision: z
        .int()
        .positive()
        .describe('The timeline revision that was reviewed, and is exported'),
      notify: z.boolean().optional().describe('Post a notification when it finishes'),
      supersedes: ulidSchema('Render').optional().describe('The render this one replaces after QA fixes'),
      name: z.string().min(1).max(120).optional(),
      rate: rateSchema.optional().describe('Requested output frame rate, for example {num:60,den:1}'),
    }),
    output: exportToolOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: RENDER_COMMANDS.export,
    checkpoint: true,
    timeoutMs: 30 * 60_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library', 'project'], write: ['app-data'] }, ...LOCAL_PERMISSION },
    // A new revision is a new action: it is not the earlier export replayed, and it asks again.
    idempotencyKey: (input) =>
      sha256([
        'render.export',
        input.projectId,
        input.timelineId,
        input.timelineRevision,
        input.supersedes ?? null,
        input.rate ? [input.rate.num, input.rate.den] : null,
      ]),
    approvalCard: (input, ctx) =>
      exportApprovalCard(
        deps,
        {
          projectId: input.projectId as ProjectId,
          timelineId: input.timelineId as TimelineId,
          timelineRevision: input.timelineRevision,
        },
        ctx,
      ),
    resultCard: async (output, ctx) => {
      const card = renderProgressCard(toolRenderSchema.parse(output.render), ctx, { survey: true });
      return card.ok ? ok(card.value) : card;
    },
    summarize: (output) =>
      `Render ${output.render.id}: ${output.render.status}` +
      (output.render.qa ? `, QA ${output.render.qa.verdict} with ${output.render.qa.failed} failing` : ''),
    run: async (input, ctx) => {
      // The command refuses (core.conflict) when the timeline has moved past the approved revision.
      const record = await dispatchAndFollow(
        deps,
        {
          projectId: input.projectId,
          timelineId: input.timelineId,
          timelineRevision: input.timelineRevision,
          notify: input.notify ?? false,
          ...(input.supersedes ? { supersedes: input.supersedes } : {}),
          ...(input.name ? { name: input.name } : {}),
          ...(input.rate ? { rate: FrameRate.of(input.rate.num, input.rate.den) } : {}),
        },
        ctx,
      );
      if (!record.ok) return record;
      const output = await exportOutput(record.value, ctx);
      if (!output.ok) return output;
      return ok({ ...output.value, ...(await credentialsOutput(deps, record.value)) });
    },
  });

  const cancel = defineTool({
    name: 'render.cancel',
    version: '1.0.0',
    description: 'Cancels a queued or running render. A finished render is left as it is.',
    tags: ['render', 'cancel', 'stop'],
    input: z.object({ projectId: ulidSchema('Project'), renderId: ulidSchema('Render') }),
    output: z.object({ renderId: ulidSchema('Render'), status: toolRenderSchema.shape.status }),
    costClass: 'local',
    sideEffect: 'write',
    command: RENDER_COMMANDS.cancel,
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL_PERMISSION,
    idempotencyKey: (input) => `render.cancel:${input.renderId}`,
    run: async (input, ctx) => {
      const done = await ctx.dispatch(input);
      return done.ok ? ok(done.value as { renderId: string; status: RenderRecord['status'] }) : done;
    },
  });

  const setExportPreset = defineTool({
    name: 'render.setExportPreset',
    version: '1.0.0',
    description:
      "Sets the project's export preset, codec and caption output. Read render.listPresets for supported " +
      'choices: master4k is portrait 2160x3840, landscape4k is 3840x2160; both support h264 or hevc. ' +
      'render.export uses these settings; its rate argument requests the output frame rate.',
    summary: "Sets the project's export preset and caption output.",
    tags: ['export', 'preset', 'platform', 'captions'],
    input: z.object({
      projectId: ulidSchema('Project'),
      timelineId: ulidSchema('Timeline').optional(),
      presetId: agentPresetIdSchema,
      codec: exportVideoCodecSchema.optional(),
      captions: renderCaptionsSchema.optional(),
    }),
    output: exportSettingsSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: RENDER_COMMANDS.setExportPreset,
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL_PERMISSION,
    idempotencyKey: (input) => sha256(['render.setExportPreset', input]),
    run: async (input, ctx) => {
      const done = await ctx.dispatch(input);
      return done.ok ? ok(exportSettingsSchema.parse(done.value)) : done;
    },
  });

  const status = defineTool({
    name: 'render.status',
    version: '1.0.0',
    description: "A render's status, QA summary and error code.",
    tags: ['render', 'status', 'progress'],
    input: z.object({ renderId: ulidSchema('Render') }),
    output: toolRenderSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: READ_RETRY,
    permission: LOCAL_PERMISSION,
    run: async (input) => {
      const record = await get(input.renderId);
      return record.ok ? ok(toToolRender(record.value)) : record;
    },
  });

  const list = defineTool({
    name: 'render.list',
    version: '1.0.0',
    description: "The project's renders, the most recent on top, with status and QA summary.",
    tags: ['render', 'list', 'exports'],
    input: z.object({ projectId: ulidSchema('Project'), limit: z.int().min(1).max(100).default(20) }),
    output: z.object({ renders: z.array(toolRenderSchema) }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: READ_RETRY,
    permission: LOCAL_PERMISSION,
    run: async (input) => {
      const listed = await deps.store.list({ projectId: input.projectId as ProjectId, limit: input.limit });
      return listed.ok ? ok({ renders: listed.value.map((record) => toToolRender(record)) }) : listed;
    },
  });

  const getQaReport = defineTool({
    name: 'render.getQaReport',
    version: '1.0.0',
    description:
      "A render's QA report: the summary, the failing checks with their fixes, and the full report as an artifact.",
    tags: ['qa', 'report', 'checks', 'review'],
    input: z.object({ renderId: ulidSchema('Render') }),
    output: z.object({
      renderId: ulidSchema('Render'),
      summary: qaSummarySchema,
      failing: z.array(failingCheckSchema),
      report: artifactRefSchema,
    }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: READ_RETRY,
    permission: LOCAL_PERMISSION,
    idempotencyKey: (input) => `render.getQaReport:${input.renderId}`,
    run: async (input, ctx) => {
      const record = await get(input.renderId);
      if (!record.ok) return record;
      const { qaReport, qa } = record.value;
      if (!qaReport || !qa) return err(NotFoundError({ entity: 'qaReport', id: input.renderId }));
      const report = await reportArtifact(record.value, ctx);
      if (!report.ok) return report;
      return ok({
        renderId: input.renderId,
        summary: qa,
        failing: failingChecks(qaReport),
        report: report.value!,
      });
    },
  });

  return defineToolModule({
    id: 'render',
    tools: [
      exportTool,
      coverExportTool(),
      renderDraftTool(deps),
      cancel,
      setExportPreset,
      status,
      list,
      getQaReport,
      listPresetsTool(deps),
      renderBatchTool(deps),
    ],
  });
}
