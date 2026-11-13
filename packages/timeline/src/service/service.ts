// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the agent process serves `appContract.timelines` from (core's
 * TimelinesService): reads with migration, a watch that yields the current
 * document and then every new revision, "find something else" for one cast
 * slot (find-alternates.ts) and the Phase 3 reads (phase3-reads.ts). Reads
 * only: edits are TIMELINE_COMMANDS.
 */
import {
  type AsyncResult,
  type EventBus,
  type ProjectId,
  type Timeline,
  type TimelineId,
  type TimelinesService,
  type TimelineStore,
  type TimelineSummary,
} from '@taalcut/core';
import { readTimelineTranscript, type TranscriptReader } from './transcript';
import type { CastingEngine } from '../casting/engine';
import type { CleanupReadDeps } from '../cleanup/cleanup-reads';
import type { EnergyCurveApplier } from '../energy/energy-deps';
import type { ExporterRegistry } from '../interchange/registry';
import { TimelineNotFound } from '../errors';
import { namedNotFound } from '../model/not-found';
import { migrateTimeline } from '../model/validate';
import { createFindAlternates } from './find-alternates';
import { phase3Reads } from './phase3-reads';
import type { TemplateFitter } from '../fit/fit-templates';
import type { TemplateReader } from './templates';

export interface TimelineServiceDeps {
  readonly transcripts?: TranscriptReader;
  readonly store: TimelineStore;
  readonly events: EventBus;
  /** Casting, for findAlternates. Absent: findAlternates is core.not_implemented. */
  readonly engine?: CastingEngine;
  readonly templates?: TemplateReader;
  /** P3-V5: the registered pro export writers, for the export dialog. */
  readonly exporters?: ExporterRegistry;
  /** P3-V9: audio's speech analyses and the app's cleanup settings. Absent: planCleanup is not served. */
  readonly cleanup?: Omit<CleanupReadDeps, 'read'>;
  /** P3-V12: the template half of the energy curve. With `engine` and `templates`, planEnergyCurve is served. */
  readonly applyEnergyCurve?: EnergyCurveApplier;
  /** LRN1-TPL: fitting templates to footage. Absent: fitTemplates is not served. */
  readonly fit?: TemplateFitter;
}

export interface TimelineService extends TimelinesService {
  /** The stored document, migrated and validated. */
  read(timelineId: TimelineId): AsyncResult<Timeline>;
}

/** Wakes a waiting watcher; rings that arrive while nobody waits are kept (one is enough). */
function latch() {
  let rung = false;
  let resolve: (() => void) | null = null;
  return {
    ring() {
      rung = true;
      resolve?.();
      resolve = null;
    },
    wait(): Promise<void> {
      if (rung) {
        rung = false;
        return Promise.resolve();
      }
      return new Promise((done) => {
        resolve = () => {
          rung = false;
          done();
        };
      });
    },
  };
}

export function createTimelineService(deps: TimelineServiceDeps): TimelineService {
  async function read(timelineId: TimelineId): AsyncResult<Timeline> {
    const stored = namedNotFound(await deps.store.get(timelineId), () => TimelineNotFound({ timelineId }));
    if (!stored.ok) return stored;
    return migrateTimeline(stored.value.json, stored.value.schemaVersion);
  }

  async function* watch(timelineId: TimelineId, signal: AbortSignal): AsyncIterable<Timeline> {
    if (signal.aborted) return;
    const wake = latch();
    let projectId: ProjectId | undefined;
    // Both come once the command's writes commit: library.changed for this timeline, command.changed for any
    // command on the project (a write from another process reaches us only through the second).
    const offChanged = deps.events.on('library.changed', (event) => {
      if (event.payload.entity === 'timeline' && event.payload.ids.includes(timelineId)) wake.ring();
    });
    const offCommand = deps.events.on('command.changed', (event) => {
      // Until the first read identifies the project, conservatively retain every commit notification.
      if (!projectId || event.payload.projectId === projectId) wake.ring();
    });
    const onAbort = () => wake.ring();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      // Install listeners before reading or yielding: a write can commit during either await.
      const first = await read(timelineId);
      if (signal.aborted) return;
      if (!first.ok) throw first.error;
      projectId = first.value.projectId;
      let revision = first.value.revision;
      yield first.value;
      while (!signal.aborted) {
        await wake.wait();
        if (signal.aborted) break;
        const next = await read(timelineId);
        if (!next.ok) throw next.error;
        if (next.value.revision === revision) continue;
        revision = next.value.revision;
        yield next.value;
      }
    } finally {
      offChanged();
      offCommand();
      signal.removeEventListener('abort', onAbort);
    }
  }

  return {
    read,
    get: read,
    async transcript(timelineId) {
      const timeline = await read(timelineId);
      return timeline.ok ? readTimelineTranscript(timeline.value, deps.transcripts) : timeline;
    },
    listByProject: (projectId: ProjectId): AsyncResult<TimelineSummary[]> =>
      deps.store.listByProject(projectId),
    watch,
    findAlternates: createFindAlternates({ read, ...deps }),
    ...phase3Reads({ read, ...deps }),
    ...(deps.fit ? { fitTemplates: deps.fit.fitTemplates } : {}),
  };
}
