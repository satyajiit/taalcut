// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How one item ends: each outcome goes to the ledger first (durable), then
 * the run in memory. A run resumed after a crash reads its own rows back.
 */
import { rm } from 'node:fs/promises';
import type { AssetId, SourceId, TaalcutError } from '@taalcut/core';
import { fileExtension } from '../names';
import { appendLedger, type LedgerOutcome, type LedgerRow } from './ledger';
import type { ItemDeps, StepResult } from './item-types';
import type { RunItem, RunRecord } from './run-store';
import { publicError, safeLine } from './text';

const DONE: StepResult = { status: 'done' };

async function settle(
  run: RunRecord,
  item: RunItem,
  deps: ItemDeps,
  outcome: LedgerOutcome,
  assetId?: AssetId,
): Promise<StepResult> {
  const row: LedgerRow = {
    name: item.name,
    sizeBytes: item.sizeBytes,
    createdAt: item.createdAt,
    outcome,
    runId: run.id,
    ...(assetId ? { assetId } : {}),
    ...(item.converted ? { converted: true } : {}),
  };
  await appendLedger(deps.stateDir, run.deviceKey, row);
  deps.freshness.record(row);
  item.state = outcome;
  if (assetId) item.assetId = assetId;
  deps.touch();
  return DONE;
}

export async function markImported(
  run: RunRecord,
  item: RunItem,
  deps: ItemDeps,
  imported: { readonly assetId: AssetId; readonly sourceId: SourceId; readonly duplicate: boolean },
): Promise<StepResult> {
  if (run.sourceId === null) run.sourceId = imported.sourceId;
  const step = await settle(run, item, deps, imported.duplicate ? 'duplicate' : 'imported', imported.assetId);
  deps.log?.info(safeLine(run.deviceKey, item.uploadId, fileExtension(item.name), item.sizeBytes));
  return step;
}

export function markDuplicate(
  run: RunRecord,
  item: RunItem,
  deps: ItemDeps,
  assetId: AssetId,
): Promise<StepResult> {
  return settle(run, item, deps, 'duplicate', assetId);
}

/** Only in iCloud: not an error, and nothing of it stays in staging (ADR 0001). */
export async function markCloud(
  run: RunRecord,
  item: RunItem,
  deps: ItemDeps,
  files: readonly string[],
): Promise<StepResult> {
  for (const file of files) await rm(file, { force: true });
  const step = await settle(run, item, deps, 'in-icloud');
  deps.log?.info(safeLine(run.deviceKey, item.uploadId, fileExtension(item.name), item.sizeBytes));
  return step;
}

/** A failed item leaves nothing behind in staging but a journal the library may still import. */
export async function fail(
  run: RunRecord,
  item: RunItem,
  deps: ItemDeps,
  error: TaalcutError,
  leftovers: readonly string[] = [],
): Promise<StepResult> {
  for (const file of leftovers) await rm(file, { force: true });
  item.error = publicError(error);
  const rejected = item.state === 'rejected' || error.code === 'transfer.not_media';
  return settle(run, item, deps, rejected ? 'rejected' : 'failed');
}

/**
 * This run already wrote the item's outcome before a crash took the run
 * file's copy: take it back without pulling the item again.
 */
export function restore(item: RunItem, row: LedgerRow, deps: ItemDeps): StepResult {
  item.state = row.outcome;
  if (row.assetId) item.assetId = row.assetId;
  if (row.converted) item.converted = true;
  deps.touch();
  return DONE;
}
