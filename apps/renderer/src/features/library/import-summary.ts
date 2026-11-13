// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the Library's import line says (UX4): one summary of every import that runs or needs a look, read from the
 * indexing status. Pure, so it is unit tested apart from the page.
 */
import type { ImportStatus, IndexingStatus } from '@taalcut/core';
import { endedWithFailures, isRunning, waitsOnly } from '@taalcut/ui';

/**
 * - `running`: clips are coming in or being analysed;
 * - `paused`: you paused it;
 * - `waiting`: what is left waits for a model or for the originals;
 * - `attention`: it ended, and some files couldn't be read;
 * - `stopped`: an import stopped (its scan failed);
 * - `analysing`: no import runs, but clips are still being analysed;
 * - `none`: nothing to say.
 */
export type ImportLineKind =
  'running' | 'paused' | 'waiting' | 'attention' | 'stopped' | 'analysing' | 'none';

export interface ImportSummary {
  readonly kind: ImportLineKind;
  /** The imports that run or need a look, each with its own detail under the line. */
  readonly sources: readonly ImportStatus[];
  /** One status that stands for them all (the counts added up): the line's bar and counts read it. */
  readonly combined: ImportStatus | null;
  /** Files that couldn't be read or finished, across them. */
  readonly failed: number;
  /** Clips still analysed outside any import. */
  readonly analysing: number;
}

/**
 * Clips being analysed: running, or waiting their turn. Not the ones held for a model or their original (LIB1-PROG):
 * nothing runs for them until it arrives, so they aren't "analysing". The window bar's indicator and Kaatu count
 * the same way.
 */
export function analysingCount(status: IndexingStatus): number {
  const { active, waiting, held = 0 } = status.overall;
  return active + Math.max(0, waiting - held);
}

const stopped = (status: ImportStatus) => status.state === 'failed' && !endedWithFailures(status);

/** The imports added up: one source stands for itself. */
function combine(sources: readonly ImportStatus[], etaMs: number | null): ImportStatus | null {
  const [first] = sources;
  if (!first) return null;
  if (sources.length === 1) return first;
  const sum = (pick: (status: ImportStatus) => number) => sources.reduce((n, s) => n + pick(s), 0);
  const searchable = sources.every((s) => s.counts.searchable !== undefined)
    ? sum((s) => s.counts.searchable ?? 0)
    : undefined;
  const running = sources.find((s) => isRunning(s.state));
  return {
    sourceId: first.sourceId,
    state: running?.state ?? (sources.some((s) => s.state === 'paused') ? 'paused' : first.state),
    counts: {
      assets: sum((s) => s.counts.assets),
      done: sum((s) => s.counts.done),
      active: sum((s) => s.counts.active),
      waiting: sum((s) => s.counts.waiting),
      failed: sum((s) => s.counts.failed),
      ...(searchable === undefined ? {} : { searchable }),
    },
    // Each import is at its own stage: the line names none for several.
    stages: [],
    etaMs,
    jobIds: sources.flatMap((s) => s.jobIds),
    updatedAt: Math.max(...sources.map((s) => s.updatedAt)),
  };
}

export function summariseImports(status: IndexingStatus | null): ImportSummary {
  const none: ImportSummary = { kind: 'none', sources: [], combined: null, failed: 0, analysing: 0 };
  if (!status) return none;
  const sources = status.sources.filter((source) => source.state !== 'done');
  const failed = sources.reduce((n, source) => n + source.counts.failed, 0);
  if (sources.length === 0) {
    const analysing = analysingCount(status);
    return { ...none, kind: analysing > 0 && !status.paused ? 'analysing' : 'none', analysing };
  }
  const combined = combine(sources, status.etaMs);
  const kind: ImportLineKind =
    status.paused || sources.every((s) => s.state === 'paused')
      ? 'paused'
      : sources.some((s) => isRunning(s.state) && !waitsOnly(s))
        ? 'running'
        : sources.some(stopped)
          ? 'stopped'
          : sources.some(waitsOnly)
            ? 'waiting'
            : 'attention';
  return { kind, sources, combined, failed, analysing: 0 };
}

/** The imports seen running on this page that have now finished: the line's moment names them. */
export function finishedSince(
  seen: ReadonlySet<string>,
  status: IndexingStatus | null,
): readonly ImportStatus[] {
  if (!status) return [];
  return status.sources.filter((source) => source.state === 'done' && seen.has(source.sourceId));
}
