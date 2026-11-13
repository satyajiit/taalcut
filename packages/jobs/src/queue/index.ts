// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The durable job engine (P1-E1). See SPEC.md, "Job engine". */
export * from './types';
export * from './ports';
export * from './errors';
export { DEFAULT_BACKOFF, DEFAULT_CONCURRENCY, backoffDelay, defaultThrottle } from './policy';
export type { BackoffPolicy, ThrottlePolicy } from './policy';
export type { ProgressReporter, ProgressValue } from './progress';
export {
  defineJob,
  isValidJobKind,
  type JobContext,
  type JobDefinition,
  type JobHandler,
} from './definition';
export type { EnqueueOptions, JobEngine, JobEngineOptions, WaitOptions } from './api';
export {
  createEngineJobRunner,
  fromJobKind,
  PRIORITY_VALUES,
  type JobRunner,
  type JobRunOptions,
} from './core-kinds';
export { createJobEngine } from './engine';
export { MemoryJobStore, type MemoryJobStoreOptions, type StoredJobRecord } from './memory-store';
