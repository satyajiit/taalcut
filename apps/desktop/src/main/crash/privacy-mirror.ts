// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Bootstrap copy of the privacy settings main can read before the library
 * opens. The settings store wins: reconcile rewrites this file from it.
 * A missing or unreadable file means crash reports are off.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PRIVACY_MIRROR_FILE = 'privacy.json';

export interface PrivacyMirror {
  readonly crashReports: boolean;
  readonly localOnly: boolean;
  readonly changedAt: number;
}

/** The settings-store values that feed the mirror (booleans, not the store object). */
export interface StoredPrivacy {
  readonly crashReports: { readonly enabled: boolean; readonly changedAt: number };
  readonly localOnly: boolean;
}

const OFF: PrivacyMirror = { crashReports: false, localOnly: false, changedAt: 0 };

export function privacyMirrorPath(userData: string): string {
  return join(userData, PRIVACY_MIRROR_FILE);
}

/** Synchronous on purpose: crash reporting is decided before app ready. */
export function readPrivacyMirror(file: string): PrivacyMirror {
  try {
    return parseMirror(readFileSync(file, 'utf8')) ?? OFF;
  } catch {
    return OFF;
  }
}

export function writePrivacyMirror(file: string, mirror: PrivacyMirror): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(mirror)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
  chmodSync(file, 0o600);
}

/** Settings store wins completely; the file is rewritten to match. */
export function reconcilePrivacyMirror(stored: StoredPrivacy, file: string): PrivacyMirror {
  const mirror: PrivacyMirror = {
    crashReports: stored.crashReports.enabled,
    localOnly: stored.localOnly,
    changedAt: stored.crashReports.changedAt,
  };
  writePrivacyMirror(file, mirror);
  return mirror;
}

function parseMirror(raw: string): PrivacyMirror | undefined {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.crashReports !== 'boolean' || typeof row.localOnly !== 'boolean') return undefined;
  if (typeof row.changedAt !== 'number' || !Number.isInteger(row.changedAt) || row.changedAt < 0)
    return undefined;
  return { crashReports: row.crashReports, localOnly: row.localOnly, changedAt: row.changedAt };
}
