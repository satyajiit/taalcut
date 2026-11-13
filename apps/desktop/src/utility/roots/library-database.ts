// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The extensions a utility process's library connection loads. The agent
 * searches the active space's vectors and the jobs process writes and
 * collects them, inside the same transactions as their rows, so both load
 * sqlite-vec into their one connection. Without the extension file (a
 * platform sqlite-vec has no build for) they open without it, and search
 * answers from keywords.
 */
import { existsSync } from 'node:fs';
import { sqliteVecPath } from '@taalcut/library';
import type { UtilityConfig } from '../../shared/rpc-ipc';

export function libraryExtensions(config: Pick<UtilityConfig, 'process'>): string[] {
  if (config.process !== 'agent' && config.process !== 'jobs') return [];
  try {
    const path = sqliteVecPath();
    return existsSync(path) ? [path] : [];
  } catch {
    return [];
  }
}
