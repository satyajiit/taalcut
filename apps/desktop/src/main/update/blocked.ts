// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Versions this Mac rolled back from (P3-B9, core UPDATE_BLOCKED_SETTING) are never downloaded again.
 * The update library asks `isUpdateSupported(info)` before it decides an update is available; the hook here refuses
 * a blocked version and otherwise defers to the updater's own check (minimum macOS version). A higher version
 * isn't blocked, so it installs, and the block on the older one is pruned at the next start (an older version
 * can't be offered anyway: allowDowngrade stays false). Main writes the setting directly: it is a fact about
 * this Mac, not a person's choice, so it isn't a command.
 */
import { UPDATE_BLOCKED_SETTING, type AsyncResult, type SettingsStore } from '@taalcut/core';
import { compareVersions } from './candidate';

const MAX_BLOCKED = 32;

/** The list without versions at or below `running`. */
export function pruneBlocked(blocked: readonly string[], running: string): string[] {
  return blocked.filter((version) => (compareVersions(version, running) ?? 1) > 0);
}

/** `version` added; the newest MAX_BLOCKED are kept. */
export function addBlocked(blocked: readonly string[], version: string): string[] {
  if (blocked.includes(version)) return [...blocked];
  return [...blocked, version].slice(-MAX_BLOCKED);
}

/**
 * The version this Mac last rolled back from, while it is still newer than the running one. The launch watch adds
 * it to the stored list asynchronously, and the first check after the rollback may come before that write lands.
 */
export function rolledBackBlock(lastRollbackTo: string | undefined, running: string): string[] {
  return lastRollbackTo ? pruneBlocked([lastRollbackTo], running) : [];
}

export function isBlocked(blocked: readonly string[], version: string): boolean {
  return blocked.includes(version.trim());
}

/** The part of the update library's AppUpdater the hook replaces. */
export interface UpdateSupportPort {
  isUpdateSupported(info: { readonly version: string }): boolean | Promise<boolean>;
}

/** Wraps the updater's own check so a blocked version is never offered. */
export function refuseBlockedVersions(updater: UpdateSupportPort, blocked: () => readonly string[]): void {
  const base = updater.isUpdateSupported.bind(updater);
  updater.isUpdateSupported = async (info) => {
    if (isBlocked(blocked(), info.version)) return false;
    return base(info);
  };
}

/** The stored list, kept in memory for the hook. */
export interface BlockedVersions {
  list(): readonly string[];
  /** Prunes what `running` makes moot. */
  load(running: string): AsyncResult<readonly string[]>;
  block(version: string): AsyncResult<readonly string[]>;
}

export function blockedVersions(settings: SettingsStore): BlockedVersions {
  let current: readonly string[] = [];
  const save = async (next: string[]) => {
    const saved = await settings.set(UPDATE_BLOCKED_SETTING, next);
    if (saved.ok) current = saved.value;
    return saved;
  };
  return {
    list: () => current,
    async load(running) {
      const stored = await settings.get(UPDATE_BLOCKED_SETTING);
      if (!stored.ok) return stored;
      const pruned = pruneBlocked(stored.value, running);
      if (pruned.length === stored.value.length) {
        current = stored.value;
        return stored;
      }
      return save(pruned);
    },
    async block(version) {
      const stored = await settings.get(UPDATE_BLOCKED_SETTING);
      if (!stored.ok) return stored;
      return save(addBlocked(stored.value, version));
    },
  };
}
