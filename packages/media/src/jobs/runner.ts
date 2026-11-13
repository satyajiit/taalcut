// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * JobRunner now lives in @taalcut/core. These re-exports keep vision, the
 * desktop app and existing tests importing the port from @taalcut/media.
 */
export {
  createDirectJobRunner,
  forwardJobProgress,
  JobRunnerToken,
  registerJob,
  type JobRegistration,
  type JobRunner,
  type JobRunOptions,
} from '@taalcut/core';
