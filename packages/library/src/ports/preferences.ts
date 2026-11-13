// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's AcknowledgementStore and SettingsStore ports (createLibraryPorts:
 * `acknowledgements`, `settings`) on the settings tables: warning-card
 * acknowledgements (PRD 10.1; the models login gate, P1-F6) and typed
 * settings declared with core's defineSetting.
 */
import {
  err,
  ok,
  ValidationError,
  type AcknowledgementRecord,
  type AcknowledgementStore,
  type AsyncResult,
  type CommandContext,
  type SettingDefinition,
  type SettingsStore,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createAcknowledgementRepository, createSettingsRepository } from '../repositories/settings';
import { writeWith, type CommandStager } from './staging';

/** The ports, their tokens and defineSetting now live in core; re-exported for existing imports. */
export {
  AcknowledgementStoreToken,
  defineSetting,
  SettingsStoreToken,
  type AcknowledgementRecord,
  type AcknowledgementStore,
  type SettingDefinition,
  type SettingsStore,
} from '@taalcut/core';

const toRecord = (row: AcknowledgementRecord): AcknowledgementRecord => ({
  featureId: row.featureId,
  termsVersion: row.termsVersion,
  acknowledgedAt: row.acknowledgedAt,
  context: row.context,
});

export function createAcknowledgementStore(db: LibraryDatabase): AcknowledgementStore {
  const repo = createAcknowledgementRepository(db);
  return {
    has: async (featureId, termsVersion) => ok(repo.has(featureId, termsVersion)),
    record: async (input) => {
      const recorded = repo.record(input);
      return recorded.ok ? ok(toRecord(recorded.value)) : recorded;
    },
    latest: async (featureId) => {
      const row = repo.latest(featureId);
      return ok(row ? toRecord(row) : null);
    },
  };
}

/**
 * Core's SettingsStore, whose writes take the command's context: a settings command passes the context
 * its handler got, and the write commits with the command's audit row (`commands`, the unit of work)
 * instead of before it. A `get` in the same handler still sees the old value.
 */
export interface LibrarySettingsStore extends SettingsStore {
  set<T>(setting: SettingDefinition<T>, value: T, context?: CommandContext): AsyncResult<T>;
  reset(setting: SettingDefinition<unknown>, context?: CommandContext): AsyncResult<void>;
}

export function createSettingsStore(
  db: LibraryDatabase,
  options: { readonly commands?: CommandStager } = {},
): LibrarySettingsStore {
  const repo = createSettingsRepository(db);
  const { commands } = options;
  return {
    get: async (setting) => {
      const stored = repo.get(setting.key, setting.schema);
      return ok(stored.ok && stored.value !== undefined ? stored.value : setting.defaultValue);
    },
    set: async (setting, value, context) => {
      const parsed = setting.schema.safeParse(value);
      if (!parsed.success) {
        return err(ValidationError({ field: setting.key }, { detail: parsed.error.message }));
      }
      const saved = writeWith(
        commands,
        context,
        () => repo.check(setting.key, parsed.data),
        () => repo.set(setting.key, parsed.data),
      );
      return saved.ok ? ok(parsed.data) : saved;
    },
    reset: async (setting, context) =>
      writeWith(
        commands,
        context,
        () => ok(undefined),
        () => repo.delete(setting.key),
      ),
  };
}
