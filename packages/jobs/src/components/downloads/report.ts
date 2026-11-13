// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The state of the download of everything this Mac needs, as a window shows it: each component's state, progress
 * and last failure, and the set's bytes, speed and time left. Built from the manager's list, the running pass and
 * what `downloads.json` says.
 */
import type { TaalcutError } from '@taalcut/core';
import type { SpaceCheck } from '../manager-api';
import type { ComponentProgress } from '../progress';
import type { ComponentStatus } from '../status';
import type { DownloadRun } from './run';
import type { SavedDownloads } from './saved';

/**
 * - `installed`: here and current. `downloading`: in a lane now. `queued`: waiting for a lane or a dependency.
 * - `failed`: its last install failed (`error`), or one it depends on did and nothing is fetching that now.
 * - `paused`: the person paused the download. `update`: an older version is here, or this one with a licence notice
 *   the manifest has replaced and nothing fetching it. `missing`: not here, not asked.
 */
export type SetEntryState =
  'installed' | 'downloading' | 'queued' | 'failed' | 'paused' | 'update' | 'missing';

export interface DownloadSetEntry {
  /** The manager's view: name, version, licence, sizes, what's installed. */
  readonly status: ComponentStatus;
  readonly state: SetEntryState;
  /** While downloading: its latest progress (phase, bytes, speed, a pending reconnect). */
  readonly progress?: ComponentProgress;
  /** While failed: why (its own install, or the dependency's). */
  readonly error?: TaalcutError;
  /** Bytes of its download on disk: all of it once installed or downloaded, else what has arrived. */
  readonly bytesDone: number;
  /**
   * What it can't run without (the manifest's dependencies, direct and indirect), so a job is ready only once these
   * are installed too, a shared runtime listed under another job included.
   */
  readonly needs: readonly string[];
}

/** See core's DOWNLOADS_STATES. */
export type DownloadSetState = 'ready' | 'downloading' | 'paused' | 'failed' | 'missing';

export interface DownloadSetStatus {
  readonly state: DownloadSetState;
  /** Everything this Mac needs, in download order. */
  readonly entries: readonly DownloadSetEntry[];
  /** Over the components this download fetches (all that aren't here, if it hasn't started). */
  readonly bytesTotal: number;
  readonly bytesDone: number;
  readonly bytesPerSecond: number;
  /** Until the last byte arrives, once there is a speed to go on. */
  readonly etaSeconds?: number;
  readonly requiredBytes: number;
  readonly availableBytes?: number;
  /** Why it couldn't start or go on. */
  readonly error?: TaalcutError;
  /**
   * LNX1-TRM: what the set holds back until the person accepts its owner's terms, with the components it would bring
   * in. Empty when nothing waits on terms.
   */
  readonly awaitingTerms: readonly AwaitingTerms[];
}

/** A component held out of the set until its owner's terms are accepted (plan.ts HeldBack), as the manager sees it. */
export interface AwaitingTerms {
  readonly status: ComponentStatus;
  readonly unlocks: readonly string[];
}

export interface ReportInput {
  /** The manager's list. */
  readonly statuses: readonly ComponentStatus[];
  /** Everything this Mac needs, in download order. */
  readonly order: readonly string[];
  readonly run: DownloadRun | undefined;
  readonly saved: SavedDownloads;
  readonly dependencies: (id: string) => readonly string[];
  readonly space: SpaceCheck;
  /** What waits on terms (plan.ts): ids, and what each brings in. */
  readonly held?: readonly { readonly id: string; readonly unlocks: readonly string[] }[];
}

/**
 * Bytes of a download on disk: all of it past the download itself, else the bytes so far. A component whose files
 * are here and only its licence notice is old has all of its download (the notice is all it fetches).
 */
function bytesOnDisk(status: ComponentStatus, progress: ComponentProgress | undefined): number {
  const size = status.downloadBytes ?? 0;
  if (status.state === 'installed' || status.state === 'notice_outdated') return size;
  if (!progress) return Math.min(size, status.partialBytes);
  if (progress.phase === 'downloading') return Math.min(size, progress.bytesDone);
  if (progress.phase === 'checking') return Math.min(size, status.partialBytes);
  return size;
}

function entryOf(status: ComponentStatus, input: ReportInput): DownloadSetEntry {
  const { run, saved } = input;
  const progress = run?.progressOf(status.id) ?? status.progress;
  const bytesDone = bytesOnDisk(status, progress);
  const base = { status, bytesDone, needs: input.dependencies(status.id) };
  if (status.state === 'installed') return { ...base, state: 'installed' };
  if (run?.isActive(status.id) || status.installing)
    return { ...base, state: 'downloading', ...pick(progress) };
  if (run?.isQueued(status.id)) return { ...base, state: 'queued' };
  if (status.lastError) return { ...base, state: 'failed', error: status.lastError };
  if (saved.paused) return { ...base, state: 'paused' };
  const older = status.state === 'update_available' || status.state === 'notice_outdated';
  return { ...base, state: older ? 'update' : 'missing' };
}

const pick = (progress: ComponentProgress | undefined) => (progress ? { progress } : {});

/**
 * A component that can't install because one it depends on failed and nothing is fetching that now: it says the
 * dependency's reason at once, rather than "queued" until the other lanes finish.
 */
function blockedBy(entry: DownloadSetEntry, byId: ReadonlyMap<string, DownloadSetEntry>, input: ReportInput) {
  if (entry.state === 'installed' || entry.state === 'downloading' || entry.state === 'failed')
    return undefined;
  for (const dep of input.dependencies(entry.status.id)) {
    const failed = byId.get(dep);
    if (failed?.state === 'failed' && failed.error) return failed.error;
  }
  return undefined;
}

function setState(entries: readonly DownloadSetEntry[], input: ReportInput): DownloadSetState {
  // Ready only once the pass is over: the registry lists an install before the install has recorded its result
  // (forgetting an old failure is written just after), and a pass ends only once every install has.
  if (input.run && !input.run.stopped) return 'downloading';
  if (entries.every((each) => each.state === 'installed')) return 'ready';
  if (input.saved.paused) return 'paused';
  if (input.saved.error || entries.some((each) => each.state === 'failed')) return 'failed';
  return 'missing';
}

export function buildReport(input: ReportInput): DownloadSetStatus {
  const byStatus = new Map(input.statuses.map((status) => [status.id, status]));
  const first = input.order.flatMap((id) => {
    const status = byStatus.get(id);
    return status ? [entryOf(status, input)] : [];
  });
  const byId = new Map(first.map((entry) => [entry.status.id, entry]));
  const entries = first.map((entry): DownloadSetEntry => {
    const error = blockedBy(entry, byId, input);
    return error ? { ...entry, state: 'failed', error } : entry;
  });
  const batch = new Set(
    input.saved.batch.length > 0
      ? input.saved.batch
      : entries.filter((each) => each.state !== 'installed').map((each) => each.status.id),
  );
  const counted = entries.filter((each) => batch.has(each.status.id));
  const bytesTotal = counted.reduce((sum, each) => sum + (each.status.downloadBytes ?? 0), 0);
  const bytesDone = counted.reduce((sum, each) => sum + each.bytesDone, 0);
  const state = setState(entries, input);
  const bytesPerSecond = state === 'downloading' ? (input.run?.bytesPerSecond() ?? 0) : 0;
  const left = Math.max(0, bytesTotal - bytesDone);
  return {
    state,
    entries,
    bytesTotal,
    bytesDone,
    bytesPerSecond,
    ...(bytesPerSecond > 0 ? { etaSeconds: Math.ceil(left / bytesPerSecond) } : {}),
    requiredBytes: input.space.requiredBytes,
    ...(input.space.availableBytes === undefined ? {} : { availableBytes: input.space.availableBytes }),
    ...(input.saved.error && state !== 'ready' ? { error: input.saved.error } : {}),
    awaitingTerms: (input.held ?? []).flatMap(({ id, unlocks }) => {
      const status = byStatus.get(id);
      return status ? [{ status, unlocks }] : [];
    }),
  };
}
