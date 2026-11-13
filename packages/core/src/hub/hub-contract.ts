// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.hub (P3-B12, P3-V8), owner agent: browsing the cached index, one template with its document, the
 * share check (exactly the document Share would send, and its problems) and this install's submissions. Reads
 * only; changes are HUB_COMMANDS. Served by @taalcut/templates' hub client.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type HubTemplateId, type TemplateId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import { FORMAT_IDS, languageTagSchema } from '../templates/template-parts';
import { hubProblemSchema } from './content-rules';
import { hubShareFormSchema, type HubShareForm } from './hub-commands';
import { hubIndexEntrySchema } from './hub-index';
import { hubTagSchema, hubTemplateV0Schema, type HubTemplateV0 } from './hub-template';
import { hubRatingSchema, SUBMISSION_STATES } from './worker-api';

export const HUB_SORTS = ['topRated', 'newest', 'freshest'] as const;
export type HubSort = (typeof HUB_SORTS)[number];

export const hubBrowseQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  language: languageTagSchema.optional(),
  formatId: z.enum(FORMAT_IDS).optional(),
  maxSeconds: z.int().min(1).max(600).optional(),
  tags: z.array(hubTagSchema).max(8).optional(),
  sort: z.enum(HUB_SORTS).default('topRated'),
  limit: z.int().min(1).max(50).default(50),
  cursor: z.string().max(200).optional(),
});
export type HubBrowseQuery = z.output<typeof hubBrowseQuerySchema>;

export const hubBrowseItemSchema = hubIndexEntrySchema.extend({
  rating: hubRatingSchema.nullable(),
  /** This install's fork, if any. */
  forkedAs: idSchema<'Template'>().nullable(),
});
export type HubBrowseItem = z.output<typeof hubBrowseItemSchema>;

export const hubBrowsePageSchema = z.object({
  items: z.array(hubBrowseItemSchema).max(50),
  nextCursor: z.string().nullable(),
});
export type HubBrowsePage = z.output<typeof hubBrowsePageSchema>;

export const hubStatusSchema = z.object({
  /** This build has a hub URL. */
  configured: z.boolean(),
  /** Local only is on: the hub is off. */
  localOnly: z.boolean(),
  indexFetchedAt: z.int().nonnegative().nullable(),
  templates: z.int().nonnegative(),
});
export type HubStatus = z.output<typeof hubStatusSchema>;

export const hubSubmissionViewSchema = z.object({
  id: idSchema<'HubSubmission'>(),
  hubId: idSchema<'HubTemplate'>(),
  version: z.int().min(1),
  templateId: idSchema<'Template'>(),
  templateVersion: z.int().min(1),
  state: z.enum(SUBMISSION_STATES),
  createdAt: z.int().nonnegative(),
  checkedAt: z.int().nonnegative().nullable(),
});
export type HubSubmissionView = z.output<typeof hubSubmissionViewSchema>;

export const hubTemplateDetailSchema = z.object({
  item: hubBrowseItemSchema,
  document: hubTemplateV0Schema,
  myRating: z.int().min(1).max(5).nullable(),
});
export type HubTemplateDetail = z.output<typeof hubTemplateDetailSchema>;

/** A share-check problem with the slot it is in (null for the document) and the form field, for the dialog. */
export const shareProblemSchema = hubProblemSchema.extend({
  slotIndex: z.int().nonnegative().nullable(),
  field: z.string().max(40),
});
export const shareCheckSchema = z.object({
  /** Exactly what Share would send; null when it can't be built. */
  document: hubTemplateV0Schema.nullable(),
  problems: z.array(shareProblemSchema).max(50),
});
export type ShareCheck = z.output<typeof shareCheckSchema>;

export const hubContract = {
  status: ipc.output(hubStatusSchema),
  browse: ipc.input(hubBrowseQuerySchema).output(hubBrowsePageSchema),
  get: ipc.input(z.object({ hubId: idSchema<'HubTemplate'>() })).output(hubTemplateDetailSchema),
  shareCheck: ipc
    .input(
      z.object({ templateId: idSchema<'Template'>(), version: z.int().min(1), form: hubShareFormSchema }),
    )
    .output(shareCheckSchema),
  /** `refresh` asks the Worker for each open submission's state. */
  submissions: ipc
    .input(z.object({ templateId: idSchema<'Template'>().optional(), refresh: z.boolean().default(false) }))
    .output(z.array(hubSubmissionViewSchema)),
};

/** What the agent process serves appContract.hub from (@taalcut/templates' hub client). */
export interface HubService {
  status(): AsyncResult<HubStatus>;
  browse(query: HubBrowseQuery): AsyncResult<HubBrowsePage>;
  get(hubId: HubTemplateId): AsyncResult<{
    readonly item: HubBrowseItem;
    readonly document: HubTemplateV0;
    readonly myRating: number | null;
  }>;
  shareCheck(input: {
    readonly templateId: TemplateId;
    readonly version: number;
    readonly form: HubShareForm;
  }): AsyncResult<ShareCheck>;
  submissions(input: {
    readonly templateId?: TemplateId;
    readonly refresh: boolean;
  }): AsyncResult<HubSubmissionView[]>;
}

export function hubRouter(service: HubService) {
  const os = implementContract(hubContract);
  return os.router({
    status: os.status.handler(async () => unwrapRpc(await service.status())),
    browse: os.browse.handler(async ({ input }) => unwrapRpc(await service.browse(input))),
    get: os.get.handler(async ({ input }) => unwrapRpc(await service.get(input.hubId))),
    shareCheck: os.shareCheck.handler(async ({ input }) => unwrapRpc(await service.shareCheck(input))),
    submissions: os.submissions.handler(async ({ input }) => unwrapRpc(await service.submissions(input))),
  });
}
