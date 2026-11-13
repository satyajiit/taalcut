// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tool input and output schemas. The registry exports both to JSON Schema
 * for the model (z.toJSONSchema, unrepresentable: 'throw'), so these use
 * plain strings for ids (core's idSchema is a custom type) and plain
 * objects for rates (core's frameRateSchema transforms).
 */
import { z } from 'zod';
import {
  exportPresetIdSchema,
  MUSIC_PATHS,
  qaCheckIdSchema,
  qaFixSchema,
  qaSummarySchema,
  RENDER_STATUSES,
  renderCaptionsSchema,
  SLOT_MATCH_CHECK_IDS,
  type JobProgress,
  type QaReport,
  type RenderRecord,
  ulidSchema,
} from '@taalcut/core';

export const rateSchema = z.object({ num: z.int().positive(), den: z.int().positive() });

export const toolProgressSchema = z.object({
  fraction: z.number().min(0).max(1).nullable(),
  stageKey: z.string().optional(),
  etaMs: z.number().nonnegative().optional(),
});

/** A render as the agent sees it: never a path. */
export const toolRenderSchema = z.object({
  id: ulidSchema('Render'),
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  timelineRevision: z.int().positive(),
  presetId: exportPresetIdSchema,
  status: z.enum(RENDER_STATUSES),
  jobId: ulidSchema('Job').nullable(),
  progress: toolProgressSchema.nullable(),
  name: z.string(),
  durationFrames: z.int().nonnegative(),
  rate: rateSchema,
  bytes: z.int().nonnegative().nullable(),
  music: z.enum(MUSIC_PATHS),
  captions: renderCaptionsSchema,
  qa: qaSummarySchema.nullable(),
  supersedes: ulidSchema('Render').nullable(),
  notify: z.boolean(),
  /** The error code when it failed (i18n `errors.<code>`). */
  errorCode: z.string().nullable(),
  createdAt: z.int().nonnegative(),
  finishedAt: z.int().nonnegative().nullable(),
});
export type ToolRender = z.output<typeof toolRenderSchema>;

export const failingCheckSchema = z.object({ id: qaCheckIdSchema, fixes: z.array(qaFixSchema) });

export function toToolRender(record: RenderRecord, progress?: JobProgress | null): ToolRender {
  const live = progress === undefined ? (record.progress ?? null) : progress;
  return {
    id: record.id,
    projectId: record.projectId,
    timelineId: record.timelineId,
    timelineRevision: record.timelineRevision,
    presetId: record.presetId,
    status: record.status,
    jobId: record.jobId,
    progress: live
      ? {
          fraction: live.fraction,
          ...(live.stageKey !== undefined ? { stageKey: live.stageKey } : {}),
          ...(live.etaMs !== undefined ? { etaMs: live.etaMs } : {}),
        }
      : null,
    name: record.name,
    durationFrames: record.durationFrames,
    rate: { num: record.rate.num, den: record.rate.den },
    bytes: record.bytes,
    music: record.music,
    captions: record.captions,
    qa: record.qa,
    supersedes: record.supersedes,
    notify: record.notify,
    errorCode: record.error?.code ?? null,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt,
  };
}

/** The failing checks and what fixes them, for the Reviewer. */
export function failingChecks(report: QaReport | null): z.output<typeof failingCheckSchema>[] {
  return (report?.checks ?? [])
    .filter((check) => check.status === 'fail')
    .map((check) => ({ id: check.id, fixes: check.fixes }));
}

const SLOT_CHECKS = new Set<string>(SLOT_MATCH_CHECK_IDS);

/**
 * AGT2-MATCH: the slot-match checks a draft misses (they warn, so `failingChecks` leaves them out), each with its
 * failing slots counted and the first five slots' fixes: what the Maker brings closer to the reel.
 */
export function slotMisses(report: QaReport | null): z.output<typeof slotMissSchema>[] {
  return (report?.checks ?? [])
    .filter((check) => SLOT_CHECKS.has(check.id) && (check.status === 'warn' || check.status === 'fail'))
    .map((check) => ({ id: check.id, slots: check.findings.length, fixes: check.fixes }));
}

export const slotMissSchema = failingCheckSchema.extend({
  /** How many slots miss (each a finding); the fixes are the first five's. */
  slots: z.int().nonnegative(),
});

export const captionSummarySchema = z.object({
  affectedItemIds: z.array(ulidSchema('CaptionCue')).optional(),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  enabled: z.boolean(),
  cues: z.int().nonnegative(),
  language: z.string().nullable(),
  styleSource: z.enum(['reference', 'preset', 'user']).nullable(),
});
