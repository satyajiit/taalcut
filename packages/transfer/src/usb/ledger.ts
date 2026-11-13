// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-device import ledger (JSON lines). A fingerprint is name, size and
 * createdAt. The device key is the file, not a column, and is never a serial.
 * The ledger is durable per item; the run file is saved less often, so a run
 * resumed after a crash takes its own earlier outcomes from here.
 */
import { open, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  err,
  idSchema,
  ok,
  toTaalcutError,
  type AssetId,
  type DeviceImportRunId,
  type ImportSink,
  type Result,
  type TaalcutError,
} from '@taalcut/core';
import type { DeviceItem } from './bridge';
import { errnoOf, syncDir } from './fs-atomic';

export { errnoOf };

const LEDGER_OUTCOMES = ['imported', 'duplicate', 'in-icloud', 'rejected', 'failed'] as const;
export type LedgerOutcome = (typeof LEDGER_OUTCOMES)[number];

const ledgerRowSchema = z.object({
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.number().nullable(),
  outcome: z.enum(LEDGER_OUTCOMES),
  assetId: idSchema<'Asset'>().optional(),
  /** The run that wrote the row. Rows written before this field existed have none. */
  runId: idSchema<'DeviceImportRun'>().optional(),
  converted: z.boolean().optional(),
});

export type LedgerRow = z.output<typeof ledgerRowSchema>;

export interface Freshness {
  isNew(item: DeviceItem): boolean;
  imported(item: DeviceItem): 'no' | 'yes' | 'in-icloud';
  /** Live asset for this fingerprint, when the library still has it. */
  liveAsset(item: DeviceItem): AssetId | null;
}

/** A run's own view: loaded once per pump, then kept current in memory. */
export interface RunFreshness extends Freshness {
  /** The row this run already wrote for the item (a crash lost the run file's copy). */
  outcomeFor(
    item: Pick<DeviceItem, 'name' | 'sizeBytes' | 'createdAt'>,
    runId: DeviceImportRunId,
  ): LedgerRow | null;
  /** A row the run just appended, so the next item sees it without reading the file again. */
  record(row: LedgerRow): void;
  /** Why the ledger or the library's assets could not be read. Only new then hides nothing. */
  readonly problem: TaalcutError | null;
}

export function ledgerPath(stateDir: string, deviceKey: string): string {
  return join(stateDir, 'usb', 'ledger', `${deviceKey}.jsonl`);
}

export function fingerprintOf(item: { name: string; sizeBytes: number; createdAt: number | null }): string {
  return `${item.name}\n${item.sizeBytes}\n${item.createdAt ?? ''}`;
}

/** A missing ledger is empty. Any other read failure is an error; a damaged line is skipped. */
export async function readLedger(
  stateDir: string,
  deviceKey: string,
): Promise<Result<Map<string, LedgerRow>>> {
  const rows = new Map<string, LedgerRow>();
  let text: string;
  try {
    text = await readFile(ledgerPath(stateDir, deviceKey), 'utf8');
  } catch (cause) {
    if (errnoOf(cause) === 'ENOENT') return ok(rows);
    return err(toTaalcutError(cause));
  }
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    const row = parseRow(line);
    if (row) rows.set(fingerprintOf(row), row);
  }
  return ok(rows);
}

export async function appendLedger(stateDir: string, deviceKey: string, row: LedgerRow): Promise<void> {
  const path = ledgerPath(stateDir, deviceKey);
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'a', 0o600);
  try {
    await handle.write(`${JSON.stringify(row)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDir(dirname(path));
}

/**
 * When the ledger or `knownAssets` can't be read, nothing is known: Only new
 * hides nothing and the library's own hash check catches duplicates. That is
 * logged (codes only) and kept as `problem`, never passed over silently.
 */
export async function loadFreshness(
  stateDir: string,
  deviceKey: string,
  sink: ImportSink,
  options: { readonly log?: { info(line: string): void } } = {},
): Promise<RunFreshness> {
  let problem: TaalcutError | null = null;
  const read = await readLedger(stateDir, deviceKey);
  const rows = read.ok ? read.value : new Map<string, LedgerRow>();
  if (!read.ok) problem = read.error;
  const ids: AssetId[] = [];
  for (const row of rows.values()) {
    if (row.assetId) ids.push(row.assetId);
  }
  let known: Set<AssetId> | null = null;
  if (sink.knownAssets) {
    const result = await sink.knownAssets(ids);
    if (result.ok) known = new Set(result.value);
    else problem ??= result.error;
  }
  if (problem) options.log?.info(`usb ledger ${deviceKey} unread ${problem.code}`);
  return {
    problem,
    isNew(item) {
      return isNewRow(rows.get(fingerprintOf(item)) ?? null, known);
    },
    imported(item) {
      return importedOf(rows.get(fingerprintOf(item)) ?? null, known);
    },
    liveAsset(item) {
      const row = rows.get(fingerprintOf(item)) ?? null;
      if (!row?.assetId || isNewRow(row, known)) return null;
      return row.assetId;
    },
    outcomeFor(item, runId) {
      const row = rows.get(fingerprintOf(item));
      return row?.runId === runId ? row : null;
    },
    record(row) {
      rows.set(fingerprintOf(row), row);
      if (row.assetId && known) known.add(row.assetId);
    },
  };
}

function isNewRow(row: LedgerRow | null, known: ReadonlySet<AssetId> | null): boolean {
  if (!row?.assetId) return true;
  if (known === null) return true;
  return !known.has(row.assetId);
}

function importedOf(row: LedgerRow | null, known: ReadonlySet<AssetId> | null): 'no' | 'yes' | 'in-icloud' {
  if (row?.outcome === 'in-icloud') return 'in-icloud';
  if (row?.assetId && known?.has(row.assetId)) return 'yes';
  return 'no';
}

/** One damaged line (a crash mid-append) is skipped; the rest of the ledger still counts. */
function parseRow(line: string): LedgerRow | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const parsed = ledgerRowSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
