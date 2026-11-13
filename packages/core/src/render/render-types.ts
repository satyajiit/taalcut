// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Renders (P2-M6, P2-M11): an export request, a render as a window sees it,
 * export options and a live preview session. A render points at a timeline
 * by its `revision` (here `timelineRevision`), the counter every timeline
 * write bumps, so a QA report is for exactly what was rendered.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { jobProgressSchema } from '../jobs/job-types';
import { frameRateSchema } from '../time/frame-rate';
import {
  contentCredentialsOptionSchema,
  exportCredentialsSchema,
  renderCredentialsSchema,
} from './content-credentials';
import { MUSIC_PATHS, musicChoiceSchema, platformSoundStepsSchema } from './music';
import { exportPresetIdSchema, exportPresetSchema, exportVideoCodecSchema } from './presets';
import { qaSummarySchema } from './qa';

const projectId = idSchema<'Project'>();
const timelineId = idSchema<'Timeline'>();
const renderId = idSchema<'Render'>();
const time = z.int().nonnegative();

export const RENDER_STATUSES = [
  'queued',
  'rendering',
  'checking',
  'fixing',
  'ready',
  'needsAttention',
  'failed',
  'cancelled',
] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];
export const SUBTITLE_FORMATS = ['srt', 'vtt'] as const;

export const RENDER_JOB_KINDS = { export: 'render.export', purge: 'render.purge' } as const;

export const renderCaptionsSchema = z.object({
  burnIn: z.boolean(),
  sidecars: z.array(z.enum(SUBTITLE_FORMATS)).max(2),
});

/** The `render.export` command's payload, kept on the Render. */
export const exportRequestSchema = z.object({
  projectId,
  timelineId,
  /** The timeline's `revision`. Default: the latest at dispatch. */
  timelineRevision: z.int().positive().optional(),
  presetId: exportPresetIdSchema,
  /** LNX1-AV1: one of the preset's `video.codecs`. Default: the preset's `video.codec`. */
  codec: exportVideoCodecSchema.optional(),
  /** Default: the timeline's rate. */
  rate: frameRateSchema.optional(),
  captions: renderCaptionsSchema,
  notify: z.boolean().default(false),
  /** Display name; default '<project> – <preset>'. Plain text. */
  name: z.string().min(1).max(120).optional(),
  /** A render this one replaces after QA fixes (its round + 1). */
  supersedes: renderId.optional(),
  /** P3-V7: add Taalcut's Content Credentials. Off unless the person turns it on. */
  contentCredentials: contentCredentialsOptionSchema.default({ add: false }),
  /** P3-V10: the resolved Style's intro and outro. */
  includeBumpers: z.boolean().default(true),
  /** P3-V16: set by render.exportBatch. */
  batchId: idSchema<'RenderBatch'>().optional(),
});
export type ExportRequest = z.output<typeof exportRequestSchema>;

export const renderExportJobInputSchema = z.object({ renderId, request: exportRequestSchema });
export const renderExportJobOutputSchema = z.object({
  renderId,
  status: z.enum(RENDER_STATUSES),
  qa: qaSummarySchema.nullable(),
});
export type RenderExportJobOutput = z.output<typeof renderExportJobOutputSchema>;

/** A render as a window sees it: never a path. */
export const renderSnapshotSchema = z.object({
  id: renderId,
  projectId,
  timelineId,
  timelineRevision: z.int().positive(),
  presetId: exportPresetIdSchema,
  status: z.enum(RENDER_STATUSES),
  jobId: idSchema<'Job'>().nullable(),
  progress: jobProgressSchema.nullable(),
  /** Display name, never a path. */
  name: z.string().min(1).max(200),
  width: z.int().positive(),
  height: z.int().positive(),
  rate: frameRateSchema,
  durationFrames: z.int().nonnegative(),
  bytes: z.int().nonnegative().nullable(),
  music: z.enum(MUSIC_PATHS),
  captions: renderCaptionsSchema,
  qa: qaSummarySchema.nullable(),
  supersedes: renderId.nullable(),
  notify: z.boolean(),
  error: publicErrorSchema.nullable(),
  /** P3-V7: whether Content Credentials were added, and their signature's state. */
  credentials: renderCredentialsSchema,
  /** P3-V16: the batch it was queued in. */
  batchId: idSchema<'RenderBatch'>().nullable(),
  createdAt: time,
  finishedAt: time.nullable(),
  deletedAt: time.nullable(),
});
export type RenderSnapshot = z.output<typeof renderSnapshotSchema>;

/** A batch's progress (P3-V16): counts of its renders by state, and the time left when known. */
export const renderBatchProgressSchema = z.object({
  batchId: idSchema<'RenderBatch'>(),
  total: z.int().min(1).max(50),
  queued: z.int().nonnegative(),
  running: z.int().nonnegative(),
  ready: z.int().nonnegative(),
  needsAttention: z.int().nonnegative(),
  failed: z.int().nonnegative(),
  cancelled: z.int().nonnegative(),
  etaMs: z.int().nonnegative().nullable(),
});
export type RenderBatchProgress = z.output<typeof renderBatchProgressSchema>;

export const exportOptionsSchema = z.object({
  projectId,
  timelineId,
  timelineRevision: z.int().positive(),
  rate: frameRateSchema,
  durationFrames: z.int().nonnegative(),
  presets: z.array(
    z.object({
      preset: exportPresetSchema,
      available: z.boolean(),
      /** Why not, e.g. 'render.unavailable.tooLong'. */
      reasonKey: z.string().min(1).optional(),
      estimate: z.object({ bytes: z.int().nonnegative(), renderMs: z.int().nonnegative() }),
      /**
       * LNX1-AV1: each of the preset's `video.codecs` on this machine, in the preset's order: whether it can be
       * encoded here and why not (`render.unavailable.noAv1Encoder`). A preset whose only codec can't is itself
       * unavailable with that reason. Absent: every codec can.
       */
      codecs: z
        .array(
          z.object({
            codec: exportVideoCodecSchema,
            available: z.boolean(),
            reasonKey: z.string().min(1).optional(),
          }),
        )
        .optional(),
    }),
  ),
  defaultPresetId: exportPresetIdSchema,
  music: z.object({
    current: musicChoiceSchema,
    referenceAudioAvailable: z.boolean(),
    /** @deprecated Always true since REF1: the reel's music needs no acknowledgement. Kept for older windows. */
    referenceAudioAcknowledged: z.boolean(),
    platformSound: platformSoundStepsSchema.nullable(),
  }),
  captions: z.object({ available: z.boolean(), enabled: z.boolean(), language: z.string().nullable() }),
  /** P3-V7: absent until render reads the sources' credentials. */
  credentials: exportCredentialsSchema.optional(),
});
export type ExportOptions = z.output<typeof exportOptionsSchema>;

/** Every URL the render side gives a window is under this origin (served by main). */
export const PREVIEW_ORIGIN = 'app://preview';
export const previewUrlSchema = z.string().startsWith(`${PREVIEW_ORIGIN}/`);

export const previewSessionSchema = z.object({
  sessionId: idSchema<'PreviewSession'>(),
  /** app://preview/<token>/index.html?rev=<n> */
  url: previewUrlSchema,
  revision: z.int().nonnegative(),
  /** The exact timeline document compiled into this build, independent of the preview cache revision. */
  timelineRevision: z.int().nonnegative().default(0),
  width: z.int().positive(),
  height: z.int().positive(),
  rate: frameRateSchema,
  durationFrames: z.int().nonnegative(),
  compositionHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PreviewSession = z.output<typeof previewSessionSchema>;
