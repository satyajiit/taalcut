// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Renders as stored. The library implements the store (it owns the
 * database); the render process and the agent's render commands use it.
 * The file path and the full QA report live here and never in a window's
 * snapshot.
 */
import type { ProjectId, RenderBatchId, RenderId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { QaReport } from './qa';
import type { ExportRequest, RenderSnapshot } from './render-types';

export interface RenderRecord extends RenderSnapshot {
  readonly request: ExportRequest;
  /** Absolute path of the finished file. Never sent to a window. */
  readonly filePath: string | null;
  readonly compositionHash: string | null;
  readonly qaReport: QaReport | null;
}

export interface RenderFilter {
  readonly projectId?: ProjectId;
  readonly includeDeleted?: boolean;
  /** Same request key, not failed, cancelled or deleted: what dedupes `render.export`. */
  readonly requestKey?: string;
  /** P3-V16: the renders of one batch. */
  readonly batchId?: RenderBatchId;
  readonly limit?: number;
}

export type RenderPatch = Partial<
  Pick<
    RenderRecord,
    | 'status'
    | 'jobId'
    | 'bytes'
    | 'qa'
    | 'qaReport'
    | 'filePath'
    | 'compositionHash'
    | 'error'
    | 'finishedAt'
    | 'deletedAt'
    | 'notify'
    | 'credentials'
  >
>;

export interface RenderStore {
  create(record: Omit<RenderRecord, 'progress'> & { readonly requestKey: string }): AsyncResult<RenderRecord>;
  get(id: RenderId): AsyncResult<RenderRecord>;
  list(filter?: RenderFilter): AsyncResult<readonly RenderRecord[]>;
  update(id: RenderId, patch: RenderPatch): AsyncResult<RenderRecord>;
}

export const RenderStoreToken = createToken<RenderStore>('core.renderStore');
