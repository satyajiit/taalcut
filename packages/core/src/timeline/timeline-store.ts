// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Timelines as stored. Implemented by @taalcut/library, registered by
 * TimelineStoreToken; writes with a CommandContext are staged in the
 * command's unit of work. Reads return the stored JSON so @taalcut/timeline
 * can migrate it before validating.
 */
import type { ProjectId, TimelineId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';
import type { Timeline } from './timeline-schema';
import type { TimelineSummary } from './timelines-contract';

export interface StoredTimeline {
  readonly summary: TimelineSummary;
  readonly schemaVersion: number;
  /** As stored; @taalcut/timeline migrates and validates it. */
  readonly json: unknown;
}

export interface TimelineStore {
  create(timeline: Timeline, context?: CommandContext): AsyncResult<TimelineSummary>;
  /** Replaces the document if the stored revision is `expectedRevision`; core.conflict otherwise. */
  put(timeline: Timeline, expectedRevision: number, context?: CommandContext): AsyncResult<TimelineSummary>;
  get(timelineId: TimelineId): AsyncResult<StoredTimeline>;
  listByProject(projectId: ProjectId): AsyncResult<TimelineSummary[]>;
  /** Only as the inverse of create. */
  remove(timelineId: TimelineId, context?: CommandContext): AsyncResult<void>;
}

export const TimelineStoreToken = createToken<TimelineStore>('core.timelineStore');
