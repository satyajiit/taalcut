// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Durable run file: the resolved items and each one's state. */
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  err,
  newId,
  ok,
  parseId,
  toTaalcutError,
  ValidationError,
  type AssetId,
  type DeviceImportRunId,
  type DeviceRun,
  type PublicError,
  type Result,
  type SourceId,
  type TransferDeviceId,
  type TransferSessionId,
  type TransferUploadId,
} from '@taalcut/core';
import type { BridgeKind, DeviceItem, DeviceItemFlags } from './bridge';
import { sweepTemps, writeAtomic } from './fs-atomic';
import { errnoOf } from './ledger';
import { runFileSchema, type ITEM_STATES } from './run-schema';
import { clipText } from './text';

export type ItemState = (typeof ITEM_STATES)[number];

export interface RunItem {
  key: string;
  itemId: string;
  name: string;
  kind: 'video' | 'image';
  sizeBytes: number;
  createdAt: number | null;
  modifiedAt: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  type: string | null;
  album: string | null;
  folder: string | null;
  flags: DeviceItemFlags;
  availability: DeviceItem['availability'];
  uploadId: TransferUploadId;
  state: ItemState;
  assetId?: AssetId;
  converted: boolean;
  error?: PublicError;
}

export interface RunRecord {
  id: DeviceImportRunId;
  deviceKey: string;
  deviceLabel: string;
  platform: 'ios' | 'android' | 'other';
  sessionId: TransferSessionId;
  bridge: BridgeKind | null;
  state: DeviceRun['state'];
  pauseReason?: NonNullable<DeviceRun['pauseReason']>;
  sourceId: SourceId | null;
  startedAt: number;
  updatedAt: number;
  items: RunItem[];
  totals: DeviceRun['totals'];
  error?: PublicError;
  bytesPerSecond?: number;
  etaMs?: number;
}

export function runsDir(stateDir: string): string {
  return join(stateDir, 'usb', 'runs');
}

export function runPath(stateDir: string, runId: string): string {
  return join(runsDir(stateDir), `${runId}.json`);
}

export function devicesPath(stateDir: string): string {
  return join(stateDir, 'usb', 'devices.json');
}

export async function saveRun(stateDir: string, run: RunRecord): Promise<void> {
  const dir = runsDir(stateDir);
  await mkdir(dir, { recursive: true });
  recompute(run);
  await writeAtomic(runPath(stateDir, run.id), JSON.stringify(run));
}

export interface LoadedRuns {
  readonly runs: RunRecord[];
  /** Run files that could not be read or failed the schema: left on disk, reported by name. */
  readonly unreadable: readonly { readonly file: string; readonly code: string }[];
  /** Temps of a process that died mid-save that could not be removed, with their errno. */
  readonly leftovers: readonly { readonly file: string; readonly code: string }[];
}

/**
 * No runs folder means no runs. Any other failure to list it is an error. Temps a process left when it
 * died mid-save are removed (a live process's stay: it may still rename them).
 */
export async function loadRuns(stateDir: string): Promise<Result<LoadedRuns>> {
  let names: string[];
  try {
    names = await readdir(runsDir(stateDir));
  } catch (cause) {
    if (errnoOf(cause) === 'ENOENT') return ok({ runs: [], unreadable: [], leftovers: [] });
    return err(toTaalcutError(cause));
  }
  const leftovers = await sweepTemps(runsDir(stateDir), names);
  const runs: RunRecord[] = [];
  const unreadable: { file: string; code: string }[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const run = await readRun(join(runsDir(stateDir), name));
    if (run.ok) runs.push(run.value);
    else unreadable.push({ file: name, code: run.error.code });
  }
  return ok({ runs, unreadable, leftovers });
}

export function toDeviceRun(run: RunRecord): DeviceRun {
  return {
    id: run.id,
    deviceKey: run.deviceKey,
    deviceLabel: clipText(run.deviceLabel, 80) || 'Phone',
    sourceId: run.sourceId,
    state: run.state,
    ...(run.pauseReason ? { pauseReason: run.pauseReason } : {}),
    totals: run.totals,
    ...(run.bytesPerSecond !== undefined ? { bytesPerSecond: run.bytesPerSecond } : {}),
    ...(run.etaMs !== undefined ? { etaMs: run.etaMs } : {}),
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    ...(run.error ? { error: run.error } : {}),
  };
}

export function itemFromDevice(item: DeviceItem, key: string, uploadId: TransferUploadId): RunItem {
  return {
    key,
    itemId: item.id,
    name: item.name,
    kind: item.kind,
    sizeBytes: item.sizeBytes,
    createdAt: item.createdAt,
    modifiedAt: item.modifiedAt,
    width: item.width,
    height: item.height,
    durationMs: item.durationMs,
    type: item.type,
    album: item.album,
    folder: item.folder,
    flags: { ...item.flags },
    availability: item.availability,
    uploadId,
    state: 'queued',
    converted: false,
  };
}

export function asDeviceItem(item: RunItem): DeviceItem {
  return {
    id: item.itemId,
    name: item.name,
    kind: item.kind,
    sizeBytes: item.sizeBytes,
    createdAt: item.createdAt,
    modifiedAt: item.modifiedAt,
    width: item.width,
    height: item.height,
    durationMs: item.durationMs,
    type: item.type,
    folder: item.folder,
    album: item.album,
    flags: item.flags,
    sidecars: [],
    availability: item.availability,
  };
}

export function terminalItem(state: ItemState): boolean {
  return (
    state === 'imported' ||
    state === 'duplicate' ||
    state === 'in-icloud' ||
    state === 'rejected' ||
    state === 'failed' ||
    state === 'cancelled'
  );
}

export function recompute(run: RunRecord): void {
  const totals: DeviceRun['totals'] = {
    items: run.items.length,
    bytes: run.items.reduce((sum, item) => sum + item.sizeBytes, 0),
    done: 0,
    bytesDone: 0,
    imported: 0,
    duplicates: 0,
    inICloud: 0,
    rejected: 0,
    failed: 0,
    converted: 0,
  };
  for (const item of run.items) {
    if (!terminalItem(item.state)) continue;
    totals.done += 1;
    totals.bytesDone += item.sizeBytes;
    if (item.state === 'imported') totals.imported += 1;
    if (item.state === 'duplicate') totals.duplicates += 1;
    if (item.state === 'in-icloud') totals.inICloud += 1;
    if (item.state === 'rejected') totals.rejected += 1;
    if (item.state === 'failed') totals.failed += 1;
    if (item.converted && (item.state === 'imported' || item.state === 'duplicate')) totals.converted += 1;
  }
  run.totals = totals;
}

export async function deviceIdFor(stateDir: string, key: string): Promise<TransferDeviceId> {
  const path = devicesPath(stateDir);
  const map = await readDeviceMap(path);
  const existing = map[key];
  const parsed = typeof existing === 'string' ? parseId<'TransferDevice'>(existing) : null;
  if (parsed?.ok) return parsed.value;
  const id = newId<'TransferDevice'>();
  map[key] = id;
  await mkdir(join(stateDir, 'usb'), { recursive: true });
  await writeAtomic(path, JSON.stringify({ devices: map }));
  return id;
}

const deviceMapSchema = z.object({ devices: z.record(z.string(), z.string()) });

/** A missing map is empty. A damaged one is replaced (new ids; ledgers are keyed by device key). Other I/O throws. */
async function readDeviceMap(path: string): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    if (errnoOf(cause) === 'ENOENT') return {};
    throw cause;
  }
  const parsed = deviceMapSchema.safeParse(parseJson(text));
  return parsed.success ? { ...parsed.data.devices } : {};
}

async function readRun(path: string): Promise<Result<RunRecord>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
  const parsed = runFileSchema.safeParse(parseJson(text));
  if (!parsed.success) return err(ValidationError(undefined, { detail: 'run file' }));
  const run: RunRecord = { ...parsed.data, totals: emptyTotals() };
  recompute(run);
  return ok(run);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: the schema rejects undefined, and the caller reports the file as unreadable.
    return undefined;
  }
}

function emptyTotals(): DeviceRun['totals'] {
  return {
    items: 0,
    bytes: 0,
    done: 0,
    bytesDone: 0,
    imported: 0,
    duplicates: 0,
    inICloud: 0,
    rejected: 0,
    failed: 0,
    converted: 0,
  };
}
