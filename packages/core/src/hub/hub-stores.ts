// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the hub client keeps what it fetched and what it sent (P3-B12): @taalcut/library implements both in the
 * agent process. The index and ratings are kept as fetched; @taalcut/templates validates them (hubIndexSchema,
 * hubRatingsSchema) on read.
 */
import type { HubSubmissionId, HubTemplateId, TemplateId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';
import type { HubSubmissionView } from './hub-contract';
import type { SubmissionState } from './worker-api';

export interface HubCachedDocument {
  /** The response's ETag, for the next conditional fetch. */
  readonly etag: string | null;
  readonly fetchedAt: number;
  /** As fetched: unvalidated. */
  readonly body: unknown;
}

export interface HubIndexCache {
  readIndex(): AsyncResult<HubCachedDocument | null>;
  writeIndex(document: HubCachedDocument): AsyncResult<void>;
  readRatings(): AsyncResult<HubCachedDocument | null>;
  writeRatings(document: HubCachedDocument): AsyncResult<void>;
}
export const HubIndexCacheToken = createToken<HubIndexCache>('core.hubIndexCache');

export interface HubSubmissionStore {
  record(submission: HubSubmissionView, context?: CommandContext): AsyncResult<void>;
  setState(id: HubSubmissionId, state: SubmissionState, checkedAt: number): AsyncResult<void>;
  list(filter: { readonly templateId?: TemplateId }): AsyncResult<HubSubmissionView[]>;
  /** The hub id and last version this install shared for a template lineage, so an update keeps the id. */
  latestFor(
    templateId: TemplateId,
  ): AsyncResult<{ readonly hubId: HubTemplateId; readonly version: number } | null>;
}
export const HubSubmissionStoreToken = createToken<HubSubmissionStore>('core.hubSubmissionStore');
