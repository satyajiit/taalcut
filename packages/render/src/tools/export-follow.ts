// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What render.export and render.draft share: dispatch the export command
 * with the project's export settings, follow its job to the end through the
 * job runner (same key, so the tool shares the queued job and cancelling the
 * tool cancels the render), and answer with the render, its failing checks
 * and the QA report as an artifact.
 */
import { z } from 'zod';
import {
  artifactRefSchema,
  forwardJobProgress,
  ok,
  type AsyncResult,
  type CommandToolContext,
  type FrameRate,
  type JobRunner,
  type ProjectId,
  type RenderId,
  type RenderRecord,
  type RenderStore,
  type SettingsStore,
  type TimelineId,
  type ToolContextBase,
} from '@taalcut/core';
import type { ExportReceipt } from '../commands/command-deps';
import type { TimelineAccess } from '../ports';
import { renderExportJob } from '../jobs/render-jobs';
import { readExportSettings, settingsCodec } from '../settings';
import { RUNNING_RENDER_STATUSES } from '../store/snapshot';
import { storedRequest } from '../store/stored-request';
import { failingCheckSchema, failingChecks, toolRenderSchema, toToolRender } from './schemas';

export interface ExportFollowDeps {
  readonly store: RenderStore;
  readonly settings?: SettingsStore;
  /** For the timeline's canvas: a preset never chosen follows its shape (BRK1, `readExportSettings`). */
  readonly timelines?: Pick<TimelineAccess, 'get'>;
  /** Main's job runner. Without it the tools return once the render is queued. */
  readonly jobs?: JobRunner;
}

export const exportOutputSchema = z.object({
  render: toolRenderSchema,
  failing: z.array(failingCheckSchema),
  /** The full QA report, as JSON. */
  report: artifactRefSchema.nullable(),
});

export interface ExportCall {
  readonly projectId: string;
  readonly timelineId: string;
  /** The revision to render; absent: the latest at dispatch. */
  readonly timelineRevision?: number;
  readonly notify: boolean;
  readonly supersedes?: string;
  readonly name?: string;
  readonly rate?: FrameRate;
}

/** The export command with the project's settings, then its job followed to the end. The final row. */
export async function dispatchAndFollow(
  deps: ExportFollowDeps,
  call: ExportCall,
  ctx: CommandToolContext,
): AsyncResult<RenderRecord> {
  const projectId = call.projectId as ProjectId;
  const timeline = deps.timelines ? await deps.timelines.get(call.timelineId as TimelineId) : null;
  const chosen = await readExportSettings(
    deps.settings,
    projectId,
    timeline?.ok ? timeline.value.canvas : undefined,
    timeline?.ok
      ? { timelineId: timeline.value.id, preferCanvas: timeline.value.exportAtCanvasSize }
      : undefined,
  );
  if (!chosen.ok) return chosen;
  const dispatched = await ctx.dispatch({
    projectId,
    timelineId: call.timelineId,
    ...(call.timelineRevision !== undefined ? { timelineRevision: call.timelineRevision } : {}),
    presetId: chosen.value.presetId,
    ...settingsCodec(chosen.value),
    ...(call.rate ? { rate: call.rate } : {}),
    captions: chosen.value.captions,
    // The person's choices: the agent never turns credentials on by itself (SPEC P3.3).
    contentCredentials: chosen.value.contentCredentials,
    includeBumpers: chosen.value.includeBumpers,
    notify: call.notify,
    ...(call.supersedes ? { supersedes: call.supersedes } : {}),
    ...(call.name ? { name: call.name } : {}),
  });
  if (!dispatched.ok) return dispatched;
  const receipt = dispatched.value as ExportReceipt;
  const get = () => deps.store.get(receipt.renderId as RenderId);
  let record = await get();
  if (!record.ok) return record;
  if (deps.jobs && RUNNING_RENDER_STATUSES.has(record.value.status)) {
    const request = storedRequest(record.value);
    if (!request.ok) return request;
    const ran = await deps.jobs.run(
      renderExportJob,
      { renderId: record.value.id, request: request.value },
      { signal: ctx.signal, onProgress: forwardJobProgress(ctx.reportProgress), projectId },
    );
    record = await get();
    if (!record.ok) return record;
    // A job error the render process didn't record (e.g. it never started) is the tool's error.
    if (!ran.ok && RUNNING_RENDER_STATUSES.has(record.value.status)) return ran;
  }
  return record;
}

/** The render's QA report as a JSON artifact; null before QA ran. */
export async function reportArtifact(record: RenderRecord, ctx: ToolContextBase) {
  const report = record.qaReport;
  if (!report) return ok(null);
  const failed = report.checks.filter((check) => check.status === 'fail').length;
  return ctx.artifacts.put({
    mediaType: 'application/json',
    data: JSON.stringify(report),
    summary: `QA report of render ${record.id}, round ${report.round}: ${report.verdict}, ${failed} failing.`,
  });
}

export async function exportOutput(
  record: RenderRecord,
  ctx: ToolContextBase,
): AsyncResult<z.input<typeof exportOutputSchema>> {
  const report = await reportArtifact(record, ctx);
  if (!report.ok) return report;
  return ok({
    render: toToolRender(record),
    failing: failingChecks(record.qaReport),
    report: report.value,
  });
}
