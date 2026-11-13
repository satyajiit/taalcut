// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Each asset's audio pass, kept for its index run (IX-A1). `acquire` runs the pass once (two callers at once
 * share it) or hands back the one already on disk; `release({ keep: true })` leaves it for a later stage
 * (language ID keeps it for the transcript), `release()` removes it once nobody holds it. Nothing outlives its
 * use for long:
 * - idle entries go after `idleMs`, and the oldest idle ones once they pass `maxIdleBytes` (swept on every
 *   acquire and release);
 * - a failed or cancelled pass removes its folder before it returns;
 * - the store writes under `<parent>/<pid>-<random>/` and, when it opens, removes the folders of processes that
 *   are gone (a crash mid-index leaves nothing behind for long);
 * - `close()` removes everything it wrote.
 *
 * With `keepPeaks`, each video's pass also takes the waveform's peaks from its PCM and keeps them (kept-peaks.ts)
 * until `peaks` hands them to `media.previews`, which waits for the proxy and so often runs after the transcript
 * removed the PCM: one audio pass per asset whichever order the stages run in.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type Result,
} from '@taalcut/core';
import {
  peaksFromSpeechPcm,
  processAlive,
  reportAnalysisFilters,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import { audioNormalisation } from '../probe-plan';
import { createEntryTable, keyOf, removeOrphans, type Entry, type EntryTable } from './asset-audio-entries';
import { runAudioPass, type AudioPassResult } from './audio-pass';
import { createKeptPeaks, type KeptPeaks } from './kept-peaks';

export interface AssetAudioRef {
  readonly path: string;
  /** BLAKE3 from library.hash: the key, so two paths to one file share a pass. Absent: the path is. */
  readonly contentHash?: string | undefined;
  /** normalise's stored plan; absent (an older job input), the store probes and plans. */
  readonly plan?: NormalisationPlan | undefined;
}

export interface AssetAudioLease {
  readonly pass: AudioPassResult;
  /** This asset's scratch folder (the PCM, the language window): removed with the entry. */
  readonly dir: string;
  /** Done with it. `keep`: a later stage of this index run reads it too. Without it, it goes once nobody holds it. */
  release(options?: { readonly keep?: boolean }): Promise<void>;
}

export interface AssetAudioStoreStats {
  readonly passes: number;
  readonly reused: number;
  readonly entries: number;
}

export interface AssetAudioStore {
  /** `<parent>/<pid>-<random>`: the helper that reads the PCM (Parakeet) must be allowed this folder. */
  readonly root: string;
  acquire(asset: AssetAudioRef, ctx: MediaContext, signal?: AbortSignal): AsyncResult<AssetAudioLease>;
  /**
   * The asset's waveform peaks (media's format): the ones its pass kept, else from its PCM, else from a new
   * pass, which stays for language ID. Media's speech-PCM port (`speechPcmPort`).
   */
  peaks(asset: AssetAudioRef, ctx: MediaContext, signal?: AbortSignal): AsyncResult<Buffer>;
  sweep(): Promise<void>;
  close(): Promise<void>;
  stats(): AssetAudioStoreStats;
}

export interface AssetAudioStoreDeps {
  readonly parent: string;
  /** Plans an asset whose ref has none. Default: probe, then media's planNormalisation. */
  readonly plan?: (path: string, ctx: MediaContext, signal?: AbortSignal) => AsyncResult<NormalisationPlan>;
  readonly now?: () => number;
  /** An entry nobody holds goes after this long. Default 20 minutes. */
  readonly idleMs?: number;
  /** Idle entries over this many bytes go, oldest first. Default 1 GiB (about nine hours of speech PCM). */
  readonly maxIdleBytes?: number;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** Each video's pass keeps its waveform peaks for `peaks` (the app draws waveforms from them). Default false. */
  readonly keepPeaks?: boolean;
  readonly pid?: number;
  readonly isAlive?: (pid: number) => boolean;
}

/** Kept waveform peaks at most: 64 MiB, about 45 hours of audio. */
const KEPT_PEAKS_MAX_BYTES = 64 * 1024 ** 2;

type Planner = (path: string, ctx: MediaContext, signal?: AbortSignal) => AsyncResult<NormalisationPlan>;

interface StoreState {
  readonly root: string;
  readonly table: EntryTable;
  readonly now: () => number;
  readonly planOf: Planner;
  readonly onFallback: ((event: ComputeFallbackEvent) => void) | undefined;
  readonly kept: KeptPeaks | undefined;
  passes: number;
  reused: number;
}

function cancelled(code: string): boolean {
  return code === 'core.cancelled' || code === 'media.cancelled';
}

/** A video's peaks, for the waveform that may run after the PCM is gone. Unreadable: the waveform decodes. */
async function keepPeaksOf(state: StoreState, key: string, plan: NormalisationPlan, pass: AudioPassResult) {
  if (!state.kept || plan.kind !== 'video') return;
  const peaks = await peaksFromSpeechPcm(pass.pcm);
  if (peaks.ok) state.kept.keep(key, peaks.value);
}

/** The asset's audio pass into `dir` (planned first when the ref has no plan). */
async function runPass(
  state: StoreState,
  { key, dir }: { readonly key: string; readonly dir: string },
  asset: AssetAudioRef,
  ctx: MediaContext,
  signal?: AbortSignal,
): Promise<Result<AudioPassResult>> {
  await mkdir(dir, { recursive: true });
  const plan = asset.plan ? ok(asset.plan) : await state.planOf(asset.path, ctx, signal);
  if (!plan.ok) return plan;
  // ebur128 and silencedetect run on the CPU: media's own record, one per process however many meters run.
  reportAnalysisFilters(state.onFallback ? { onComputeFallback: state.onFallback } : {});
  state.passes += 1;
  const out = join(dir, 'speech.wav');
  const pass = await runAudioPass(
    { path: asset.path, plan: plan.value, out, ...(signal ? { signal } : {}) },
    ctx,
  );
  if (pass.ok) await keepPeaksOf(state, key, plan.value, pass.value);
  return pass;
}

function startEntry(
  state: StoreState,
  key: string,
  asset: AssetAudioRef,
  ctx: MediaContext,
  signal?: AbortSignal,
): Entry {
  const dir = join(state.root, createHash('sha256').update(key).digest('hex').slice(0, 16));
  const ready = runPass(state, { key, dir }, asset, ctx, signal);
  const entry: Entry = { dir, ready, refs: 0, discard: false, lastUsed: state.now() };
  state.table.entries.set(key, entry);
  return entry;
}

function leaseOf(state: StoreState, key: string, entry: Entry, pass: AudioPassResult): AssetAudioLease {
  let released = false;
  return {
    pass,
    dir: entry.dir,
    async release(options) {
      if (released) return;
      released = true;
      entry.refs -= 1;
      entry.lastUsed = state.now();
      if (!options?.keep) entry.discard = true;
      if (entry.refs === 0 && entry.discard) await state.table.remove(key, entry);
      await state.table.sweep();
    },
  };
}

/** The asset's pass, shared or new; one shared with a caller who cancelled fails as cancelled, so it starts its own. */
async function acquireFrom(
  state: StoreState,
  asset: AssetAudioRef,
  ctx: MediaContext,
  signal?: AbortSignal,
): AsyncResult<AssetAudioLease> {
  const key = keyOf(asset);
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = state.table.entries.get(key);
    const entry = existing ?? startEntry(state, key, asset, ctx, signal);
    if (existing?.pass) state.reused += 1;
    entry.refs += 1;
    const result = await entry.ready;
    if (result.ok) {
      entry.pass = result.value;
      entry.discard = false;
      return ok(leaseOf(state, key, entry, result.value));
    }
    entry.refs -= 1;
    if (entry.refs === 0) await state.table.remove(key, entry);
    if (!existing || signal?.aborted || !cancelled(result.error.code)) return err(result.error);
  }
  return err(CancelledError());
}

/** Kept peaks, else the pass's PCM read now (a new pass stays for language ID, which usually comes next). */
async function peaksFrom(
  state: StoreState,
  asset: AssetAudioRef,
  ctx: MediaContext,
  signal?: AbortSignal,
): AsyncResult<Buffer> {
  const kept = state.kept?.take(keyOf(asset));
  if (kept) return ok(kept);
  const lease = await acquireFrom(state, asset, ctx, signal);
  if (!lease.ok) return lease;
  const made = state.kept?.take(keyOf(asset));
  const peaks = made ? ok(made) : await peaksFromSpeechPcm(lease.value.pass.pcm);
  await lease.value.release({ keep: true });
  return peaks;
}

export function createAssetAudioStore(deps: AssetAudioStoreDeps): AssetAudioStore {
  const pid = deps.pid ?? process.pid;
  const root = join(deps.parent, `${pid}-${randomUUID().slice(0, 8)}`);
  const now = deps.now ?? Date.now;
  const limits = { idleMs: deps.idleMs ?? 20 * 60_000, maxIdleBytes: deps.maxIdleBytes ?? 1024 ** 3 };
  const state: StoreState = {
    root,
    table: createEntryTable(now, limits),
    now,
    planOf: deps.plan ?? audioNormalisation,
    onFallback: deps.onFallback,
    kept: deps.keepPeaks
      ? createKeptPeaks(now, { idleMs: limits.idleMs, maxBytes: KEPT_PEAKS_MAX_BYTES })
      : undefined,
    passes: 0,
    reused: 0,
  };
  const sweep = async () => {
    state.kept?.sweep();
    await state.table.sweep();
  };
  let opened: Promise<void> | undefined;
  /** The root, after removing what dead processes left beside it. */
  const open = () =>
    (opened ??= (async () => {
      await mkdir(deps.parent, { recursive: true });
      await removeOrphans(deps.parent, pid, deps.isAlive ?? processAlive);
      await mkdir(root, { recursive: true });
    })());
  /** Every call opens the store and sweeps it first. */
  const swept = async <T>(run: () => Promise<T>): Promise<T> => {
    await open();
    await sweep();
    return run();
  };

  return {
    root,
    acquire: (asset, ctx, signal) => swept(() => acquireFrom(state, asset, ctx, signal)),
    peaks: (asset, ctx, signal) => swept(() => peaksFrom(state, asset, ctx, signal)),
    sweep,
    async close() {
      state.table.entries.clear();
      state.kept?.clear();
      await rm(root, { recursive: true, force: true });
    },
    stats: () => ({ passes: state.passes, reused: state.reused, entries: state.table.entries.size }),
  };
}
