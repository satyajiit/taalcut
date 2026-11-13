// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The files in <userData>/updates/ that main and the update guard (native/taalcut-cli's `update-guard`) share
 * (P3-B9, desktop SPEC "Rollback on a failed launch"). The guard reads pending.json and writes rolled-back.json
 * and install-failed.json; main writes pending.json and the healthy-<version> markers. Every file is parsed with
 * zod here: what the guard or a damaged disk left is untrusted. Writes are atomic (temp file, then rename), 0600.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineError, err, ok, UPDATE_CHANNELS, type Result } from '@taalcut/core';
import { z } from 'zod';

/** A file in updates/ exists but isn't what main or the guard writes. */
export const UpdateFileInvalid = defineError<{ file: string }>('desktop.update_file_invalid');

const version = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  .max(64);
const absolute = z.string().startsWith('/').max(4096);
const epochMs = z.int().nonnegative();
/** The guard's clock is a Double of milliseconds (Swift), so its times can have a fraction: main rounds them. */
const guardEpochMs = z
  .number()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .transform((ms) => Math.round(ms));

export const pendingUpdateSchema = z.object({
  v: z.literal(1),
  /** The version installed when the update was staged, and the one a rollback restores. */
  from: version,
  to: version,
  appPath: absolute,
  rollbackApp: absolute,
  library: absolute,
  at: epochMs,
  /** Launches of `to` so far; main increments it first thing (launch-check.ts). */
  launchAttempts: z.int().nonnegative(),
  /** Extra facts for update.installed telemetry; the guard ignores them. */
  channel: z.enum(UPDATE_CHANNELS).optional(),
  delta: z.boolean().optional(),
});
export type PendingUpdate = z.output<typeof pendingUpdateSchema>;

export const ROLLBACK_REASONS = ['install-timeout', 'launch-failed', 'hung', 'rollback-now'] as const;
export type RollbackReason = (typeof ROLLBACK_REASONS)[number];

export const rolledBackSchema = z.object({
  v: z.literal(1),
  /** The version the guard restored. */
  from: version,
  /** The version that didn't start. */
  to: version,
  reason: z.enum(ROLLBACK_REASONS),
  at: guardEpochMs,
});
export type RolledBack = z.output<typeof rolledBackSchema>;

export const installFailedSchema = z.object({
  v: z.literal(1),
  from: version,
  to: version,
  at: guardEpochMs,
});

export interface UpdatePaths {
  readonly dir: string;
  readonly pending: string;
  /** Written by the guard after a rollback; main turns it into last-rollback.json at the next start. */
  readonly rolledBack: string;
  /** The rollback About shows (rollback-notice.ts). */
  readonly lastRollback: string;
  readonly installFailed: string;
  readonly guardDir: string;
  readonly guardBinary: string;
  readonly guardLog: string;
  readonly rollbackDir: string;
  readonly failedDir: string;
  healthy(version: string): string;
  rollbackApp(version: string): string;
}

export function updatePaths(userData: string): UpdatePaths {
  const dir = join(userData, 'updates');
  return {
    dir,
    pending: join(dir, 'pending.json'),
    rolledBack: join(dir, 'rolled-back.json'),
    lastRollback: join(dir, 'last-rollback.json'),
    installFailed: join(dir, 'install-failed.json'),
    guardDir: join(dir, 'guard'),
    guardBinary: join(dir, 'guard', 'taalcut'),
    guardLog: join(dir, 'guard.log'),
    rollbackDir: join(dir, 'rollback'),
    failedDir: join(dir, 'failed'),
    healthy: (v) => join(dir, `healthy-${version.parse(v)}`),
    rollbackApp: (v) => join(dir, 'rollback', `Taalcut-${version.parse(v)}.app`),
  };
}

/** The file parsed with `schema`; null when it doesn't exist. */
export function readUpdateFile<S extends z.ZodType>(file: string, schema: S): Result<z.output<S> | null> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return ok(null);
    return err(UpdateFileInvalid({ file: basename(file) }, { detail: (cause as Error).message }));
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err(UpdateFileInvalid({ file: basename(file) }, { detail: 'not JSON' }));
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    return err(UpdateFileInvalid({ file: basename(file) }, { detail: parsed.error.message }));
  return ok(parsed.data);
}

/** Atomic: a reader (the guard) never sees half a file. */
export function writeUpdateFile(file: string, value: unknown): Result<void> {
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    renameSync(temp, file);
    return ok(undefined);
  } catch (cause) {
    rmSync(temp, { force: true });
    return err(UpdateFileInvalid({ file: basename(file) }, { detail: (cause as Error).message }));
  }
}

/** A file or an empty marker; never a folder (bundles go through bundle-ops.ts). */
export function removeUpdateFile(file: string): void {
  rmSync(file, { force: true });
}

function basename(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1);
}
