// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { publicErrorSchema } from '../basics/error-schema';
import { rationalTimeSchema } from '../time/rational-time';
import { videoAspectSchema } from '../timeline/simple-editor';

export const CREATION_CATEGORIES = ['product-launch', 'custom'] as const;
export const CREATION_STATUSES = [
  'draft',
  'researching',
  'awaiting-approval',
  'producing',
  'ready',
  'failed',
  'cancelled',
] as const;
export const CREATION_ROLES = ['director', 'researcher', 'writer', 'designer', 'voice', 'reviewer'] as const;
export const CREATION_MAX_AGENTS = 6;
const words = z.string().max(12_000);
const duration = rationalTimeSchema.refine((time) => time.value > 0, 'A positive duration');

export const creationVoiceSchema = z.object({
  mode: z.enum(['none', 'connected', 'upload']),
  voiceId: z.string().max(200).nullable(),
  assetId: idSchema<'Asset'>().nullable(),
  language: z.string().min(2).max(35),
});

export const creationBriefSchema = z.object({
  category: z.enum(CREATION_CATEGORIES),
  title: z.string().trim().min(1).max(200),
  prompt: words,
  audience: z.string().max(1000),
  callToAction: z.string().max(1000),
  formats: z.array(videoAspectSchema).min(1).max(4),
  duration,
  voice: creationVoiceSchema,
});
export type CreationBrief = z.output<typeof creationBriefSchema>;

export const creationEvidenceSchema = z.object({
  sourceId: idSchema<'CreationSource'>(),
  locator: z.string().max(2000),
  summary: z.string().max(4000),
});
export type CreationEvidence = z.output<typeof creationEvidenceSchema>;

/** accessId is a main-owned grant; renderer records never expose a source directory's absolute path. */
export const creationSourceInputSchema = z
  .object({
    id: idSchema<'CreationSource'>(),
    kind: z.enum(['url', 'directory', 'asset']),
    label: z.string().min(1).max(200),
    url: z.url().max(4000).optional(),
    accessId: z.string().min(1).max(200).optional(),
    assetId: idSchema<'Asset'>().optional(),
  })
  .refine(
    (source) =>
      source.kind === 'url'
        ? !!source.url
        : source.kind === 'directory'
          ? !!source.accessId
          : !!source.assetId,
    'The source needs its URL, directory grant, or asset',
  );
export const creationSourceSchema = creationSourceInputSchema.safeExtend({
  status: z.enum(['pending', 'ready', 'failed']),
  content: z.string().max(100_000).optional(),
  evidence: z.array(creationEvidenceSchema).max(100),
  assetIds: z.array(idSchema<'Asset'>()).max(100).default([]),
});
export type CreationSourceInput = z.output<typeof creationSourceInputSchema>;
export type CreationSource = z.output<typeof creationSourceSchema>;

export const creationBeatSchema = z.object({
  id: z.string().min(1).max(100),
  duration,
  narration: z.string().max(2000),
  screenText: z.string().max(2000),
  visual: words,
  transition: z.string().max(2000),
});
export const creationDraftSchema = z.object({
  revision: z.int().positive(),
  title: z.string().min(1).max(200),
  visualDirection: words,
  visualPreviewAssetId: idSchema<'Asset'>().nullable(),
  /** Answers require a revised script and fresh styleframe before exact-revision approval. */
  answersPending: z.boolean().optional(),
  beats: z.array(creationBeatSchema).min(1).max(100),
  questions: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        prompt: z.string().min(1).max(2000),
        required: z.boolean(),
        answer: z.string().max(4000).nullable(),
      }),
    )
    .max(20),
});
export type CreationDraft = z.output<typeof creationDraftSchema>;

export const creationTaskSchema = z.object({
  id: idSchema<'CreationTask'>(),
  key: z.string().min(1).max(200),
  inputRevision: z.int().nonnegative(),
  costMicros: z.int().nonnegative(),
  tokens: z.int().nonnegative(),
  parentId: idSchema<'CreationTask'>().nullable(),
  role: z.enum(CREATION_ROLES),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  progress: z.number().min(0).max(1),
  message: z.string().max(2000),
  artifact: z
    .string()
    .max(1024 * 1024)
    .nullable(),
});
export type CreationTask = z.output<typeof creationTaskSchema>;

export const creationProjectSchema = z.object({
  projectId: idSchema<'Project'>(),
  revision: z.int().positive(),
  brief: creationBriefSchema,
  sources: z.array(creationSourceSchema).max(50),
  draft: creationDraftSchema.nullable(),
  approvedDraftRevision: z.int().positive().nullable(),
  status: z.enum(CREATION_STATUSES),
  tasks: z.array(creationTaskSchema).max(200),
  budget: z.object({
    capMicros: z.int().nonnegative().nullable(),
    spentMicros: z.int().nonnegative(),
    reservedMicros: z.int().nonnegative(),
  }),
  timelineId: idSchema<'Timeline'>().nullable(),
  /** Editor revisions approved for production; publication refuses to overwrite subsequent manual edits. */
  publicationBase: z
    .array(z.object({ timelineId: idSchema<'Timeline'>(), revision: z.int().nonnegative() }))
    .max(4)
    .optional(),
  error: publicErrorSchema.nullable(),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});
export type CreationProject = z.output<typeof creationProjectSchema>;
