// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A crash of main itself leaves no dump (P2-X5 writes none), so it is found at the next launch. While
 * crash reporting is on, `userData/last-run.json` ({ version, startedAt }) exists for as long as main
 * runs; quitting removes it, and so does turning reporting off. One still there at the next start means
 * that run ended without quitting (a crash, a force quit, a power cut). Every start takes the file away,
 * so a run is reported once, and only when reporting is still on.
 */
import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LAST_RUN_FILE = 'last-run.json';

export interface LastRun {
  readonly version: string;
  /** Epoch ms. */
  readonly startedAt: number;
}

export function lastRunPath(userData: string): string {
  return join(userData, LAST_RUN_FILE);
}

/** Reads and removes the previous run's file. Undefined when it quit (no file) or the file is damaged. */
export function takeLastRun(file: string): LastRun | undefined {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn(`[crash] the last run's file could not be read: ${String(cause)}`);
    return undefined;
  }
  clearLastRun(file);
  return parseLastRun(raw);
}

/** Written at start while reporting is on; 0600 like the privacy mirror. */
export function markRun(file: string, run: LastRun): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(run)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}

export function clearLastRun(file: string): void {
  rmSync(file, { force: true });
}

function parseLastRun(raw: string): LastRun | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.version !== 'string' || !/^[0-9A-Za-z.+-]{1,64}$/.test(row.version)) return undefined;
  if (typeof row.startedAt !== 'number' || !Number.isInteger(row.startedAt) || row.startedAt < 0)
    return undefined;
  return { version: row.version, startedAt: row.startedAt };
}
