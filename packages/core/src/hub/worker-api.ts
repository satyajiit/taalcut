// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hub Worker's API (P3-B12, docs/template-hub.md section 5): request and response bodies for submissions,
 * ratings and reports, and every error body. The app's hub client and services/hub-worker both validate with
 * these. An install key is 128 random bits, base64url, kept in the keychain (`taalcut-hub`); the Worker stores only
 * its salted hash.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ulidSchema } from '../basics/id-schema';
import { hubProblemSchema } from './content-rules';
import { HUB_ERROR_CODES } from './hub-error-codes';
import { hubIdSchema } from './hub-parts';
import { hubTemplateV0Schema } from './hub-template';

export const HUB_REPORT_REASONS = ['copyright', 'personalInfo', 'spam', 'offensive', 'other'] as const;
export type HubReportReason = (typeof HUB_REPORT_REASONS)[number];
export const SUBMISSION_STATES = ['open', 'merged', 'closed', 'hidden'] as const;
export type SubmissionState = (typeof SUBMISSION_STATES)[number];

export const hubInstallKeySchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);

export const hubSubmissionRequestSchema = z.object({
  installKey: hubInstallKeySchema,
  template: hubTemplateV0Schema,
});
export const hubSubmissionResponseSchema = z.object({
  submissionId: ulidSchema('HubSubmission'),
  hubId: hubIdSchema,
  version: z.int().min(1),
  state: z.enum(SUBMISSION_STATES),
  /** The pull request on the hub repository. */
  pullRequest: z.int().positive(),
});
export const hubSubmissionStateSchema = z.object({ state: z.enum(SUBMISSION_STATES) });

export const hubRatingRequestSchema = z.object({
  installKey: hubInstallKeySchema,
  stars: z.int().min(1).max(5),
});
export const hubWithdrawRatingSchema = z.object({ installKey: hubInstallKeySchema });
export const hubRatingSchema = z.object({ count: z.int().nonnegative(), mean: z.number().min(0).max(5) });
export type HubRating = z.output<typeof hubRatingSchema>;
export const hubRatingsSchema = z.object({
  generatedAt: z.int().nonnegative(),
  ratings: z.record(hubIdSchema, hubRatingSchema),
});

export const hubReportRequestSchema = z.object({
  installKey: hubInstallKeySchema,
  hubId: hubIdSchema,
  reason: z.enum(HUB_REPORT_REASONS),
  note: z.string().max(500).optional(),
});
export const hubReportResponseSchema = z.object({ issue: z.int().positive() });

/** Every Worker error body. */
export const hubErrorBodySchema = z.object({
  code: z.enum(HUB_ERROR_CODES),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  problems: z.array(hubProblemSchema).max(50).optional(),
  retryAfterSeconds: z.int().nonnegative().optional(),
});
export type HubErrorBody = z.output<typeof hubErrorBodySchema>;
