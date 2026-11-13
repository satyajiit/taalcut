// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.renders, served by the render process: presets, export
 * options, the renders list and its live updates, QA reports, media URLs
 * under app://preview, live preview sessions and subtitle text. Every
 * change is a command (render-commands.ts); this contract only reads.
 */
import '../basics/zod-config';
import { coverImageInputSchema, coverImageSchema } from '../timeline/cover';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { eventIterator, ipc } from '../ipc/contract';
import { exportPresetSchema } from './presets';
import { qaReportSchema } from './qa';
import {
  exportOptionsSchema,
  previewSessionSchema,
  previewUrlSchema,
  renderBatchProgressSchema,
  renderSnapshotSchema,
  SUBTITLE_FORMATS,
} from './render-types';

const projectId = idSchema<'Project'>();
const timelineId = idSchema<'Timeline'>();
const renderId = idSchema<'Render'>();
const sessionId = idSchema<'PreviewSession'>();

export const RENDER_MEDIA_KINDS = ['video', 'poster', 'frame'] as const;

export const rendersContract = {
  coverImage: ipc.input(coverImageInputSchema).output(coverImageSchema),
  presets: ipc.output(z.array(exportPresetSchema)),
  exportOptions: ipc.input(z.object({ projectId, timelineId })).output(exportOptionsSchema),
  /** Newest first. Soft-deleted renders are left out. */
  list: ipc
    .input(z.object({ projectId: projectId.optional(), limit: z.int().min(1).max(500).optional() }))
    .output(z.array(renderSnapshotSchema)),
  get: ipc.input(z.object({ renderId })).output(renderSnapshotSchema),
  /** The current list first, then the list again on every change (progress at most 4 per second). */
  watch: ipc
    .input(z.object({ projectId: projectId.optional() }))
    .output(eventIterator(z.array(renderSnapshotSchema))),
  /** P3-V16: a batch's progress now, then again on every change. */
  watchBatch: ipc
    .input(z.object({ batchId: idSchema<'RenderBatch'>() }))
    .output(eventIterator(renderBatchProgressSchema)),
  qaReport: ipc.input(z.object({ renderId })).output(qaReportSchema),
  /** URL of a render's file, its poster, or a frame (QA details). 'video' needs ready or needsAttention. */
  mediaUrl: ipc
    .input(z.object({ renderId, kind: z.enum(RENDER_MEDIA_KINDS), frame: z.int().nonnegative().optional() }))
    .output(z.object({ url: previewUrlSchema })),
  openPreview: ipc.input(z.object({ projectId, timelineId })).output(previewSessionSchema),
  /** Recompiles at the timeline's latest revision; same session, next revision. */
  refreshPreview: ipc.input(z.object({ sessionId })).output(previewSessionSchema),
  closePreview: ipc.input(z.object({ sessionId })).output(z.object({ closed: z.boolean() })),
  /** The timeline's captions as SRT or VTT text; the window saves it as a download. */
  subtitles: ipc
    .input(
      z.object({
        projectId,
        timelineId,
        format: z.enum(SUBTITLE_FORMATS),
        wordTimestamps: z.boolean().optional(),
      }),
    )
    .output(z.object({ fileName: z.string().min(1).max(200), text: z.string() })),
};
