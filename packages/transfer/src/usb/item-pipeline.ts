// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One queued item: pull, verify, journal, then importStaged. A journal already on disk is not pulled again. */
import { rename, rm } from 'node:fs/promises';
import { toTaalcutError, type StagedImport, type TaalcutError } from '@taalcut/core';
import { ImportFailed, NotMedia } from '../errors';
import { writeImportJournal } from '../handoff/journal';
import { TRANSFER_LIMITS } from '../limits';
import { HashMismatch, ShortRead } from './errors';
import { syncDir, syncFile } from './fs-atomic';
import { classifyIcloud } from './icloud';
import { fail, markCloud, markDuplicate, markImported, restore } from './item-outcome';
import { discard, itemFiles, readJournal, stagedFor, type ItemFiles } from './item-staging';
import type { ItemDeps, PauseReason, StepResult } from './item-types';
import { errnoOf } from './ledger';
import { pullToPart, sourceSha } from './pull';
import { asDeviceItem, type RunItem, type RunRecord } from './run-store';
import { verifyItem } from './verify';

export type { ItemControl, ItemDeps, StepResult } from './item-types';

interface Tries {
  short: number;
  hash: number;
  downloadFailed: number;
}

export async function importItem(run: RunRecord, item: RunItem, deps: ItemDeps): Promise<StepResult> {
  const files = itemFiles(deps.stagingDir, item);
  const retained = await deps.sink.retainDestination?.(item.uploadId);
  if (retained && !retained.ok) return fail(run, item, deps, retained.error);
  try {
    return await oneItem(run, item, deps, files);
  } catch (cause) {
    if (errnoOf(cause) === 'ENOSPC') return { status: 'paused', reason: 'disk-full' };
    const stop = await stopped(item, deps, files);
    if (stop) return stop;
    return fail(run, item, deps, toTaalcutError(cause), [files.part]);
  } finally {
    if (retained?.ok) retained.value();
  }
}

async function oneItem(run: RunRecord, item: RunItem, deps: ItemDeps, files: ItemFiles): Promise<StepResult> {
  const parked = await stopped(item, deps, files);
  if (parked) return parked;
  // This run already settled the item (the ledger is written before the run file): nothing to redo.
  const earlier = deps.freshness.outcomeFor(item, run.id);
  if (earlier) return restore(item, earlier, deps);
  const existing = await readJournal(files);
  if (existing) return commitImport(run, item, deps, existing, files);
  const live = deps.freshness.liveAsset(asDeviceItem(item));
  if (live) return markDuplicate(run, item, deps, live);
  if (classifyIcloud(facts(deps, item, null, false, 0)) === 'in-icloud')
    return markCloud(run, item, deps, [files.part, files.final]);
  return pullAndCheck(run, item, deps, files);
}

async function pullAndCheck(
  run: RunRecord,
  item: RunItem,
  deps: ItemDeps,
  files: ItemFiles,
): Promise<StepResult> {
  const tries: Tries = { short: 0, hash: 0, downloadFailed: 0 };
  for (;;) {
    const stop = await stopped(item, deps, files);
    if (stop) return stop;
    item.state = 'pulling';
    deps.touch();
    const pulled = await pullToPart({
      session: deps.session,
      itemId: item.itemId,
      partPath: files.part,
      signal: deps.signal,
      onBytes: deps.onBytes,
      ...(deps.sink.space
        ? { space: deps.sink.space, owner: item.uploadId, expectedBytes: item.sizeBytes }
        : {}),
    });
    if (!pulled.ok) {
      const after = await afterFailedPull(run, item, deps, files, pulled.error, tries);
      if (after) return after;
      continue;
    }
    const source = await sourceSha(deps.session, item.itemId, deps.signal);
    const halt = await stopped(item, deps, files);
    if (halt) return halt;
    if (!source.ok) {
      const paused = pauseFor(source.error);
      if (paused) return paused;
      // The device could not hash it: the check is retried once, never skipped.
      tries.hash += 1;
      await rm(files.part, { force: true });
      if (tries.hash < 2) continue;
      return fail(run, item, deps, HashMismatch(undefined, { detail: source.error.code }));
    }
    item.state = 'checking';
    deps.touch();
    const verdict = await verifyItem({
      item: asDeviceItem(item),
      path: files.part,
      sha256: pulled.value.sha256,
      sourceSha256: source.value,
      media: deps.media,
      signal: deps.signal,
    });
    const shortOriginal = verdict.kind === 'short' || (verdict.kind === 'ok' && verdict.placeholder);
    if (shortOriginal && classifyIcloud(facts(deps, item, null, true, 0)) === 'in-icloud') {
      return markCloud(run, item, deps, [files.part, files.final]);
    }
    if (verdict.kind === 'short') {
      tries.short += 1;
      await rm(files.part, { force: true });
      if (tries.short < 3) continue;
      return fail(run, item, deps, ShortRead());
    }
    if (verdict.kind === 'rejected') return fail(run, item, deps, NotMedia(), [files.part]);
    if (verdict.kind === 'hash') {
      tries.hash += 1;
      await rm(files.part, { force: true });
      if (tries.hash < 2) continue;
      return fail(run, item, deps, HashMismatch());
    }
    await rename(files.part, files.final);
    await syncFile(files.final);
    await syncDir(deps.stagingDir);
    const staged = stagedFor(run, item, deps, {
      path: files.final,
      sha256: pulled.value.sha256,
      sourceSha256: source.value,
      reencode: verdict.reencode,
    });
    await writeImportJournal(deps.stagingDir, staged);
    return commitImport(run, item, deps, staged, files);
  }
}

/** Null: pull again. A paused item keeps its part, so a bridge with ranged reads carries on from it. */
async function afterFailedPull(
  run: RunRecord,
  item: RunItem,
  deps: ItemDeps,
  files: ItemFiles,
  error: TaalcutError,
  tries: Tries,
): Promise<StepResult | null> {
  const stop = await stopped(item, deps, files);
  if (stop) return stop;
  const paused = pauseFor(error);
  if (paused) return paused;
  const detail = error.detail ?? null;
  if (detail === 'devices.download_failed') tries.downloadFailed += 1;
  if (classifyIcloud(facts(deps, item, detail, false, tries.downloadFailed)) === 'in-icloud') {
    return markCloud(run, item, deps, [files.part, files.final]);
  }
  if (detail === 'devices.download_failed' && deps.iCloudPhotos && tries.downloadFailed < 2) return null;
  // A bridge that came up short mid-read gets the same 2 retries as a short file (SPEC step 3); a ranged
  // bridge carries on from the part it kept.
  if (error.code === 'transfer.short_read') {
    tries.short += 1;
    if (tries.short < 3) return null;
  }
  return fail(run, item, deps, error, [files.part]);
}

async function commitImport(
  run: RunRecord,
  item: RunItem,
  deps: ItemDeps,
  staged: StagedImport,
  files: ItemFiles,
): Promise<StepResult> {
  const owned: ItemFiles = { ...files, final: staged.path };
  item.state = 'importing';
  item.converted =
    staged.reencode.verdict === 'likely' && staged.reencode.reasons.includes('device-converted');
  deps.touch();
  let failure: TaalcutError | null = null;
  for (let attempt = 1; attempt <= TRANSFER_LIMITS.importRetries; attempt += 1) {
    const stop = await stopped(item, deps, owned);
    if (stop) return stop;
    const result = await deps.sink.importStaged(staged, { signal: deps.signal });
    if (result.ok) {
      return markImported(run, item, deps, {
        assetId: result.value.assetId,
        sourceId: result.value.sourceId,
        duplicate: result.value.duplicate !== 'none',
      });
    }
    // A cancel that lands while the import fails takes the file and its journal with it.
    const halted = await stopped(item, deps, owned);
    if (halted) return halted;
    if (result.error.code === 'library.originals_offline')
      return { status: 'paused', reason: 'originals-offline' };
    failure = result.error;
    if (!result.error.retryable) break;
  }
  return fail(run, item, deps, failure ?? ImportFailed());
}

/** Paused or cancelled from outside. A cancelled item's files go now; a paused one keeps them. */
async function stopped(item: RunItem, deps: ItemDeps, files: ItemFiles): Promise<StepResult | null> {
  const stop = gate(item, deps);
  if (!stop) return null;
  if (stop.status === 'cancelled') await discard(files);
  deps.touch();
  return stop;
}

function gate(item: RunItem, deps: ItemDeps): StepResult | null {
  if (deps.control.cancelled()) {
    if (!doneState(item.state)) item.state = 'cancelled';
    return { status: 'cancelled' };
  }
  const reason = deps.control.pauseReason();
  if (!reason && !deps.signal.aborted) return null;
  if (item.state === 'pulling' || item.state === 'checking') item.state = 'queued';
  return { status: 'paused', reason: reason ?? 'person' };
}

/** Failures that pause the run instead of failing the item. */
function pauseFor(error: TaalcutError): StepResult | null {
  const reasons: Readonly<Record<string, PauseReason>> = {
    'transfer.device_gone': 'device-gone',
    'transfer.device_locked': 'locked',
    'transfer.disk_full': 'disk-full',
  };
  const reason = reasons[error.code];
  return reason ? { status: 'paused', reason } : null;
}

function doneState(state: RunItem['state']): boolean {
  return (
    state === 'imported' ||
    state === 'duplicate' ||
    state === 'in-icloud' ||
    state === 'rejected' ||
    state === 'failed'
  );
}

function facts(
  deps: ItemDeps,
  item: RunItem,
  detail: string | null,
  shortOriginal: boolean,
  downloadFailedCount: number,
) {
  return {
    iCloudPhotos: deps.iCloudPhotos,
    availability: item.availability,
    detail,
    shortOriginal,
    downloadFailedCount,
  };
}
