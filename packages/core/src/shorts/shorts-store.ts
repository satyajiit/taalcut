// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ProjectId, ShortsRunId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { ShortsRun } from './shorts-schema';

/** Durable editorial decisions survive derived-media cache eviction. */
export interface ShortsRunStore {
  get(id: ShortsRunId): AsyncResult<ShortsRun | null>;
  put(run: ShortsRun): AsyncResult<void>;
  list(projectId: ProjectId): AsyncResult<readonly ShortsRun[]>;
}
export interface ShortsCache {
  get(key: string): AsyncResult<unknown | null>;
  put(key: string, value: unknown): AsyncResult<void>;
}
export const ShortsRunStoreToken = createToken<ShortsRunStore>('core.shortsRunStore');
export const ShortsCacheToken = createToken<ShortsCache>('core.shortsCache');
