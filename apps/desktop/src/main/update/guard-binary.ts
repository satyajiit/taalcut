// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The update guard main starts is always a fresh copy of the one inside the running, signed bundle
 * (Contents/Resources/bin/taalcut), made right before the start (security review SB-40): never a binary that sat
 * in <userData>/updates/guard since the update was staged, which any process of the account could have swapped.
 * The copy goes in beside the target and is renamed over it, so a guard already running from the old file keeps
 * its own (overwriting a running binary in place would break its code signature and get it killed).
 */
import { chmodSync, copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export function installGuard(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const staged = `${target}.${process.pid}.new`;
  try {
    copyFileSync(source, staged);
    chmodSync(staged, 0o755);
    renameSync(staged, target);
  } finally {
    rmSync(staged, { force: true });
  }
}
