// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What the render command handlers take and return (render-commands.ts, queue-export.ts, batch). */
import type {
  AsyncResult,
  Clock,
  EventBus,
  JobEnqueuer,
  JobId,
  QaReport,
  RenderId,
  RenderRecord,
  RenderStatus,
  RenderStore,
  SettingsStore,
  TimelineId,
} from '@taalcut/core';
import type { RenderFolders } from '../engine/deps';
import type { TimelineAccess } from '../ports';

export interface RenderCommandDeps {
  readonly store: RenderStore;
  /** The jobs process's queue (through main): render.export enqueues without waiting. */
  readonly enqueuer: JobEnqueuer;
  readonly timelines: TimelineAccess;
  /** Export settings; an in-memory store when absent (tests). */
  readonly settings?: SettingsStore;
  readonly clock: Pick<Clock, 'now'>;
  /** Where a needsAttention render's file waits, and where delivery puts it ("Export anyway"). */
  readonly folders?: Pick<RenderFolders, 'work' | 'renders'>;
  /** Replaces the default delivery (finalizeRender over `folders`). */
  readonly deliver?: (record: RenderRecord, report: QaReport) => AsyncResult<RenderRecord>;
  /** For render.finished after "Export anyway" and after cancelling a render that never started. */
  readonly events?: Pick<EventBus, 'emit'>;
  readonly newRenderId?: () => RenderId;
  /**
   * Keeps the exported revision as an `export` version (the library's timeline versions), so the render
   * reads exactly it after later edits. Called before the render row is made; a failure refuses the export.
   */
  readonly snapshotExport?: (input: {
    readonly timelineId: TimelineId;
    readonly revision: number;
    readonly label: string;
  }) => AsyncResult<unknown>;
}

/** The command's result: the render, and its job (null only for a deduplicated render that never got one). */
export interface ExportReceipt {
  readonly renderId: RenderId;
  readonly jobId: JobId | null;
}

/** render.overrideQa's result: delivered (ready) once every failure is overridden, else still needsAttention. */
export interface OverrideResult {
  readonly renderId: RenderId;
  readonly status: RenderStatus;
  readonly verdict: QaReport['verdict'];
}
