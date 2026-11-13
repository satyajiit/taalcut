// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The download's components as the rows people read (UX2-DOWNLOADER): one row per job ("Speech", "Search", …), its
 * parts named quietly after it, in the jobs' own order. A row says the state that matters most of its parts: a part
 * on its way first, then a failure (the others can't finish the job without it), then waiting, paused, missing,
 * and Ready only once every part is here, and every part they need that another row lists (a shared runtime: ONNX
 * Runtime is Search's, and text in frames, shots and beats run on it). A shared part's bytes count on its own row
 * only, so the rows add up to the whole. A part that serves no named job gets a row of its own.
 */
import {
  COMPONENT_JOBS,
  type Component,
  type ComponentJob,
  type DownloadStep,
  type PublicError,
} from '@taalcut/core';

export type JobState = 'ready' | 'downloading' | 'failed' | 'queued' | 'paused' | 'missing';

export interface JobGroup {
  /** The job, or the part's id for a part with none. */
  readonly key: string;
  readonly job: ComponentJob | null;
  readonly parts: readonly Component[];
  readonly state: JobState;
  /** The parts' sizes, and what of them is on this Mac. */
  readonly bytesTotal: number;
  readonly bytesDone: number;
  /** While downloading: the step to say ("Reconnecting" over "Checking" over the rest). */
  readonly step?: DownloadStep;
  /** Step `reconnecting`: the earliest next try (epoch ms). */
  readonly retryAt?: number;
  /** A part that failed: the first one's reason. */
  readonly error?: PublicError;
  /** The parts that failed (Try again puts them first), a shared one this row needs included. */
  readonly failedIds: readonly string[];
  /** Its own parts are here, but not a shared part it needs from another row: that part's name ("ONNX Runtime"). */
  readonly needs?: string;
}

const STATE_ORDER: readonly JobState[] = ['downloading', 'failed', 'queued', 'paused', 'missing'];

/** The step a row says for its moving parts: a dropped connection first, then bytes arriving, then checking. */
const STEP_ORDER: readonly DownloadStep[] = [
  'reconnecting',
  'downloading',
  'resuming',
  'verifying',
  'installing',
];

function stateOf(part: Component): JobState {
  switch (part.status) {
    case 'installed':
      return 'ready';
    case 'downloading':
      return 'downloading';
    case 'failed':
      return 'failed';
    case 'queued':
      return 'queued';
    case 'paused':
      return 'paused';
    case 'not-installed':
    case 'update-available':
      return 'missing';
  }
}

/** What a part another row lists means for a row that needs it: here, or the row waits on it. */
function waitOf(part: Component): JobState {
  const state = stateOf(part);
  return state === 'downloading' ? 'queued' : state;
}

/** Bytes of a part on this Mac: all of it once installed, else what has arrived. */
export function bytesHere(part: Component): number {
  if (part.status === 'installed') return part.sizeBytes;
  return Math.min(part.sizeBytes, part.bytesDone ?? 0);
}

/** The component manager names a part by its id; the row says its name ("Whisper tiny"). */
function namedError(error: PublicError, all: readonly Component[]): PublicError {
  const id = error.params?.['component'];
  const part = typeof id === 'string' ? all.find((each) => each.id === id) : undefined;
  return part ? { ...error, params: { ...error.params, component: part.name } } : error;
}

function group(
  key: string,
  job: ComponentJob | null,
  parts: readonly Component[],
  all: readonly Component[],
): JobGroup {
  const own = new Set(parts.map((part) => part.id));
  // What the parts can't run without that another row lists: the job isn't ready until those are here too.
  const shared = all.filter(
    (each) => !own.has(each.id) && parts.some((part) => part.needs?.includes(each.id)),
  );
  const states = [...parts.map(stateOf), ...shared.map(waitOf)];
  const state = STATE_ORDER.find((each) => states.includes(each)) ?? 'ready';
  const moving = parts.filter((part) => part.status === 'downloading');
  const step = STEP_ORDER.find((each) => moving.some((part) => (part.step ?? 'downloading') === each));
  const retries = moving.flatMap((part) => (part.retryAt === undefined ? [] : [part.retryAt]));
  const failed = [...parts, ...shared].filter((part) => part.status === 'failed');
  const error = failed.find((part) => part.error)?.error;
  const waiting = parts.every((part) => part.status === 'installed')
    ? shared.find((each) => each.status !== 'installed')
    : undefined;
  return {
    key,
    job,
    parts,
    state,
    bytesTotal: parts.reduce((sum, part) => sum + part.sizeBytes, 0),
    bytesDone: parts.reduce((sum, part) => sum + bytesHere(part), 0),
    ...(state === 'downloading' && step ? { step } : {}),
    ...(step === 'reconnecting' && retries.length > 0 ? { retryAt: Math.min(...retries) } : {}),
    ...(error ? { error: namedError(error, all) } : {}),
    failedIds: failed.map((part) => part.id),
    ...(waiting ? { needs: waiting.name } : {}),
  };
}

/** The components as job rows, in the jobs' order; parts without a job last, each on its own row. */
export function jobGroups(components: readonly Component[]): JobGroup[] {
  const byJob = COMPONENT_JOBS.flatMap((job) => {
    // The job's main model first, then what it runs on: the largest part leads.
    const parts = components.filter((part) => part.job === job).sort((a, b) => b.sizeBytes - a.sizeBytes);
    return parts.length > 0 ? [group(job, job, parts, components)] : [];
  });
  const loose = components
    .filter((part) => part.job === undefined)
    .map((part) => group(part.id, null, [part], components));
  return [...byJob, ...loose];
}

/** Over some components (a clip's): their bytes, and whether each is here. */
export function totalsOf(components: readonly Component[]): {
  bytesTotal: number;
  bytesDone: number;
  ready: boolean;
} {
  return {
    bytesTotal: components.reduce((sum, part) => sum + part.sizeBytes, 0),
    bytesDone: components.reduce((sum, part) => sum + bytesHere(part), 0),
    ready: components.every((part) => part.status === 'installed'),
  };
}
