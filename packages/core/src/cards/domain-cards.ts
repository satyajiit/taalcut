// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Cards for the domain steps (P2-L1, P2-L13, P2-T2, P2-M5 to P2-M7,
 * P2-M13): the source picker, an import's progress, the breakdown, the cast
 * board, a timeline, a render's progress, its QA report and the one export
 * approval. They reference stored things by id (the
 * template, the timeline, the render), which stay the source of truth: the
 * components read them through their namespaces (`templates.get`,
 * `timelines.watch`, `renders.watch`), so an edit or ⌘Z shows without a new
 * card. Inside a flow they carry the step's `flowStepRefSchema`.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { thumbnailRefSchema } from '../analysis/media-facts';
import { jobProgressSchema } from '../jobs/job-types';
import { importStatusSchema } from '../library/indexing';
import { sourceViewSchema } from '../library/library-types';
import { exportCredentialsSchema } from '../render/content-credentials';
import { MUSIC_PATHS } from '../render/music';
import { exportPresetIdSchema } from '../render/presets';
import { QA_STATUSES, qaCheckIdSchema, qaFixSchema, qaSummarySchema } from '../render/qa';
import { RENDER_STATUSES, renderCaptionsSchema } from '../render/render-types';
import { REFERENCE_INPUTS, REFERENCE_PLATFORMS } from '../templates/template-parts';
import { templateRefSchema } from '../templates/template-schema';
import { rationalTimeSchema } from '../time/rational-time';
import { base, runId } from './card-parts';
import { flowStepRefSchema, flowVariantSchema } from './flow-cards';

const projectId = idSchema<'Project'>();
const timelineId = idSchema<'Timeline'>();
const renderId = idSchema<'Render'>();

export const BREAKDOWN_STAGES = [
  'fetching',
  'preparing',
  'cuts',
  'beats',
  'text',
  'speech',
  'contactSheet',
  'intents',
  'ready',
  'failed',
  'cancelled',
] as const;
export type BreakdownStage = (typeof BREAKDOWN_STAGES)[number];

/** Where the footage is: the sources so far, and the ways to add one (files.pickFolder, transfer.open). */
export const sourcePickerCardSchema = z.object({
  type: z.literal('sourcePicker'),
  ...base,
  runId: runId.optional(),
  step: flowStepRefSchema.optional(),
  sources: z.array(sourceViewSchema).max(200),
  offers: z.array(z.enum(['folder', 'phone'])).max(2),
  status: z.enum(['pending', 'added']),
});

/** One source's import and indexing, with the newest few thumbnails as they land. */
export const importProgressCardSchema = z.object({
  type: z.literal('importProgress'),
  ...base,
  runId: runId.optional(),
  sourceId: idSchema<'Source'>(),
  status: importStatusSchema,
  thumbnails: z.array(thumbnailRefSchema).max(8),
});

/** A reference becoming a template. Re-sent under the same id as the breakdown moves on. */
export const breakdownCardSchema = z.object({
  type: z.literal('breakdown'),
  ...base,
  runId,
  step: flowStepRefSchema.optional(),
  jobId: idSchema<'Job'>().optional(),
  stage: z.enum(BREAKDOWN_STAGES),
  progress: jobProgressSchema.nullable(),
  source: z.object({
    input: z.enum(REFERENCE_INPUTS),
    platform: z.enum(REFERENCE_PLATFORMS).nullable(),
    duration: rationalTimeSchema.nullable(),
  }),
  /** Set once the template exists; the card reads it with templates.get. */
  template: templateRefSchema.nullable(),
  error: publicErrorSchema.optional(),
});

/** The cast, one timeline per variant. While the step asks how many variants, `castId` is null and `timelineIds` empty. */
export const castBoardCardSchema = z.object({
  type: z.literal('castBoard'),
  ...base,
  runId,
  step: flowStepRefSchema.optional(),
  projectId,
  castId: idSchema<'Cast'>().nullable(),
  /** One per variant, in variant order. */
  timelineIds: z.array(timelineId).max(10),
  /** Slots under the confidence line after any rerank. */
  lowConfidence: z.int().nonnegative(),
  /** The one question. Answered with chat.decideApproval({ answer: { kind: 'variants', count } }). */
  asking: z
    .object({
      approvalId: z.string().min(1),
      suggested: z.int().min(1).max(10),
      slotCount: z.int().positive(),
    })
    .optional(),
});

export const timelineCardSchema = z.object({
  type: z.literal('timeline'),
  ...base,
  runId: runId.optional(),
  step: flowStepRefSchema.optional(),
  projectId,
  timelineId,
  /** The timeline's `revision` when the card was sent; the component watches for newer ones. */
  revision: z.int().min(1),
  duration: rationalTimeSchema,
  clipCount: z.int().nonnegative(),
});

/** A render's progress (PRD 9.2): Cancel and Notify me (render.setNotify). The poster comes from renders.mediaUrl. */
export const renderProgressCardSchema = z.object({
  type: z.literal('renderProgress'),
  ...base,
  runId: runId.optional(),
  renderId,
  projectId,
  jobId: idSchema<'Job'>().optional(),
  presetId: exportPresetIdSchema,
  status: z.enum(RENDER_STATUSES),
  progress: jobProgressSchema.nullable(),
  notify: z.boolean(),
  qa: qaSummarySchema.nullable(),
  /** Ask "Would you post this?" once it is ready (exports, telemetry on). */
  survey: z.boolean().optional(),
});

/** On every render (gate criterion 4). "View details" reads renders.qaReport. */
export const qaReportCardSchema = z.object({
  type: z.literal('qaReport'),
  ...base,
  runId: runId.optional(),
  step: flowStepRefSchema.optional(),
  renderId,
  projectId,
  summary: qaSummarySchema,
  /** The card face: failing first, then fixed, then warnings. */
  checks: z
    .array(
      z.object({
        id: qaCheckIdSchema,
        status: z.enum(QA_STATUSES),
        labelKey: z.string().min(1),
        overridable: z.boolean(),
        fixes: z.array(qaFixSchema).max(3),
      }),
    )
    .max(6),
});

export const EXPORT_APPROVAL_STATUSES = [
  'pending',
  'updating',
  'exporting',
  'exported',
  'declined',
  'expired',
] as const;

/**
 * The run's one approval (P2-M13): render.export's approvalCard. Choices are
 * pre-filled by the agent and all changeable (render.setExportPreset,
 * captions.setEnabled, music.choosePath); "Export" answers `approvalId`.
 */
export const exportApprovalCardSchema = z.object({
  type: z.literal('exportApproval'),
  ...base,
  runId,
  approvalId: z.string().min(1),
  projectId,
  timelineId,
  timelineRevision: z.int().positive(),
  presetId: exportPresetIdSchema,
  presets: z.array(exportPresetIdSchema).min(1),
  captions: renderCaptionsSchema,
  music: z.enum(MUSIC_PATHS),
  /** The QA-checked draft the preview plays; null when the run made none. */
  draft: z.object({ renderId, qa: qaSummarySchema }).nullable(),
  variant: flowVariantSchema.optional(),
  status: z.enum(EXPORT_APPROVAL_STATUSES),
  /** Set once exporting. */
  renderId: renderId.optional(),
  /** P3-V7: the Content Credentials switch and its note; absent on Phase 2 cards. */
  credentials: exportCredentialsSchema.optional(),
  /** P3-V16: one approval for a whole batch; its items are in the renderBatch card beside it. */
  batch: z.object({ batchId: idSchema<'RenderBatch'>(), items: z.int().min(1).max(50) }).optional(),
});
