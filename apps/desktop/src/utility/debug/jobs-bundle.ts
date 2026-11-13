// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Debug-bundle sections from the jobs process: job rows and component
 * status, without payloads, results, error detail or install paths.
 * The parent replaces jobs-root's debugBundle notServedRouter with jobsDebugRouter.
 */
import {
  debugBundleContract,
  implementContract,
  type DebugCollectOptions,
  type DebugSection,
} from '@taalcut/core';
import { toWire } from '../../shared/wire';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface JobsDebugInput {
  readonly id: string;
  readonly kind: string;
  readonly state: string;
  readonly updatedAt: number;
  readonly projectId?: string | null;
  readonly attempt?: number;
  readonly attempts?: number;
  readonly priority: string | number;
  readonly progress?: { readonly fraction?: number | null; readonly stageKey?: string } | number | null;
  readonly output?: unknown;
  readonly error?: { readonly code?: string; readonly detail?: string } | null;
}

export interface ComponentDebugInput {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly state: string;
  readonly licence: { readonly spdx: string };
  readonly installed?: { readonly path?: string };
}

export interface JobsDebugSource {
  jobs: () => Promise<readonly JobsDebugInput[]>;
  components: () => Promise<readonly ComponentDebugInput[]>;
  now?: () => number;
}

export function toJobsDebugJob(job: JobsDebugInput): {
  id: string;
  kind: string;
  state: string;
  updatedAt: number;
  projectId: string | null;
  attempts: number;
  priority: string | number;
  progress: { fraction: number | null; stageKey?: string } | null;
  errorCode: string | null;
} {
  const progress = job.progress;
  return {
    id: job.id,
    kind: job.kind,
    state: job.state,
    updatedAt: job.updatedAt,
    projectId: job.projectId ?? null,
    attempts: job.attempts ?? job.attempt ?? 0,
    priority: job.priority,
    progress:
      typeof progress === 'number'
        ? { fraction: progress }
        : progress
          ? {
              fraction: progress.fraction ?? null,
              ...(progress.stageKey ? { stageKey: progress.stageKey } : {}),
            }
          : null,
    errorCode: job.error?.code ?? null,
  };
}

export function toJobsDebugComponent(component: ComponentDebugInput): {
  id: string;
  name: string;
  version: string;
  state: string;
  licence: { spdx: string };
} {
  return {
    id: component.id,
    name: component.name,
    version: component.version,
    state: component.state,
    licence: { spdx: component.licence.spdx },
  };
}

/** `sinceMs` is an epoch millisecond. Omitted: the last 24 hours. */
export function jobsDebugSections(
  jobs: readonly JobsDebugInput[],
  components: readonly ComponentDebugInput[],
  options: DebugCollectOptions,
  now: number = Date.now(),
): DebugSection[] {
  const cutoff = options.sinceMs ?? now - DAY_MS;
  let droppedPaths = 0;
  let droppedText = 0;
  const rows = jobs
    .filter((job) => job.updatedAt >= cutoff)
    .map((job) => {
      if (job.output !== undefined) droppedText += 1;
      if (job.error?.detail) droppedText += 1;
      return toJobsDebugJob(job);
    });
  const listed = components.map((component) => {
    if (component.installed?.path) droppedPaths += 1;
    return toJobsDebugComponent(component);
  });
  const none = { text: 0, paths: 0, secrets: 0 };
  return [
    {
      section: 'jobs',
      process: 'jobs',
      path: 'jobs/rows.ndjson',
      mediaType: 'application/x-ndjson',
      text: rows.map((row) => JSON.stringify(row)).join('\n'),
      redactions: { ...none, text: droppedText },
    },
    {
      section: 'components',
      process: 'jobs',
      path: 'jobs/components.json',
      mediaType: 'application/json',
      text: JSON.stringify(listed),
      redactions: { ...none, paths: droppedPaths },
    },
  ];
}

export function jobsDebugRouter(source: JobsDebugSource) {
  const os = implementContract(debugBundleContract);
  return os.router({
    collect: os.collect.handler(async ({ input }) => {
      const now = source.now?.() ?? Date.now();
      const sections = jobsDebugSections(await source.jobs(), await source.components(), input, now);
      return toWire(sections);
    }),
  });
}
