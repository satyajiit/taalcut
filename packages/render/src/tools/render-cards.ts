// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The cards of the `render.export` tool: the run's one approval
 * (exportApproval, P2-M13), pre-filled from the project's export settings,
 * and the render's progress card in place of the tool row.
 */
import { type z } from 'zod';
import {
  ConflictError,
  err,
  exportApprovalCardSchema,
  ok,
  renderProgressCardSchema,
  type AsyncResult,
  type Card,
  type ProjectId,
  type RenderStore,
  type Result,
  type SettingsStore,
  type TimelineId,
  type ToolCardContext,
} from '@taalcut/core';
import { planTimeline } from '../plan/render-plan';
import type { TimelineAccess } from '../ports';
import { EXPORT_PRESETS, presetAvailability } from '../presets/presets.v1';
import { readExportSettings } from '../settings';
import { parsedAs } from '../validate';
import type { ToolRender } from './schemas';

export interface ExportCardDeps {
  readonly store: Pick<RenderStore, 'list'>;
  readonly timelines: TimelineAccess;
  readonly settings?: SettingsStore;
}

/** A card checked against its schema; a mismatch is a bug here, reported as a value. */
function checked(schema: z.ZodType<Card>, value: unknown): Result<Card> {
  return parsedAs(schema, value, 'card');
}

/** Only a draft of the approved revision can supply its preview and QA summary. */
async function draftOf(
  deps: ExportCardDeps,
  projectId: ProjectId,
  timelineId: TimelineId,
  timelineRevision: number,
) {
  const renders = await deps.store.list({ projectId, limit: 50 });
  if (!renders.ok) return renders;
  const draft = renders.value.find(
    (record) =>
      record.timelineId === timelineId &&
      record.timelineRevision === timelineRevision &&
      record.qa !== null &&
      (record.status === 'ready' || record.status === 'needsAttention'),
  );
  return ok(draft?.qa ? { renderId: draft.id, qa: draft.qa } : null);
}

/**
 * The approval for one revision: the card refuses (core.conflict) when the
 * timeline has moved past it, so it never shows one timeline and approves another.
 */
export async function exportApprovalCard(
  deps: ExportCardDeps,
  input: {
    readonly projectId: ProjectId;
    readonly timelineId: TimelineId;
    readonly timelineRevision: number;
  },
  ctx: ToolCardContext & { readonly approvalId: string },
): AsyncResult<Card> {
  const timeline = await deps.timelines.get(input.timelineId);
  if (!timeline.ok) return timeline;
  if (timeline.value.revision !== input.timelineRevision)
    return err(ConflictError({ entity: 'timeline', id: input.timelineId }));
  const plan = planTimeline(timeline.value);
  if (!plan.ok) return plan;
  const chosen = await readExportSettings(deps.settings, input.projectId, timeline.value.canvas, {
    timelineId: timeline.value.id,
    preferCanvas: timeline.value.exportAtCanvasSize,
  });
  if (!chosen.ok) return chosen;
  const rate = timeline.value.canvas.rate;
  // LNX1-AV1: the card is built where no media context is (main), so it can't ask whether this machine encodes
  // AV1; it lists the AV1 presets only when the person chose one in the export dialog, which did ask.
  const available = EXPORT_PRESETS.filter(
    (preset) =>
      preset.video.codec !== 'av1' && presetAvailability(preset, rate, plan.value.durationFrames).available,
  ).map((preset) => preset.id);
  const draft = await draftOf(deps, input.projectId, input.timelineId, input.timelineRevision);
  if (!draft.ok) return draft;
  return checked(exportApprovalCardSchema, {
    type: 'exportApproval',
    id: `exportApproval:${ctx.toolCallId}`,
    version: 1,
    runId: ctx.runId,
    approvalId: ctx.approvalId,
    projectId: input.projectId,
    timelineId: input.timelineId,
    timelineRevision: input.timelineRevision,
    presetId: chosen.value.presetId,
    // The chosen preset stays listed even when the timeline no longer fits it: the card says why.
    presets: available.includes(chosen.value.presetId) ? available : [chosen.value.presetId, ...available],
    captions: chosen.value.captions,
    music: timeline.value.music.path,
    draft: draft.value,
    status: 'pending',
  });
}

/**
 * The render's progress card. `survey`: an export (not a draft) asks "Would you post this?" once it is ready
 * (P2-X7; the window asks only while telemetry is on, once per render).
 */
export function renderProgressCard(
  render: ToolRender,
  ctx: ToolCardContext,
  options: { readonly survey?: boolean } = {},
): Result<Card> {
  return checked(renderProgressCardSchema, {
    type: 'renderProgress',
    id: `renderProgress:${render.id}`,
    version: 1,
    runId: ctx.runId,
    renderId: render.id,
    projectId: render.projectId,
    ...(render.jobId ? { jobId: render.jobId } : {}),
    presetId: render.presetId,
    status: render.status,
    progress: render.progress,
    notify: render.notify,
    qa: render.qa,
    ...(options.survey ? { survey: true } : {}),
  });
}
