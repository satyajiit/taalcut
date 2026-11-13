// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Typed settings, and acknowledgements of warning cards (PRD 10.1: the
 * subscription sign-in cards, P1-F6). @taalcut/library implements both on its
 * settings tables (createLibraryPorts: `settings`, `acknowledgements`); each
 * package declares its own settings with defineSetting.
 */
import '../basics/zod-config';
import type { ZodType } from 'zod';
import { ValidationError } from '../basics/errors';
import { err, ok, type AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';

export interface AcknowledgementRecord {
  readonly featureId: string;
  readonly termsVersion: string;
  /** Epoch ms. */
  readonly acknowledgedAt: number;
  /** Whatever the card stored with it (never secrets), or null. */
  readonly context: unknown;
}

export interface AcknowledgementStore {
  /** Whether the user acknowledged exactly this terms version of the feature. */
  has(featureId: string, termsVersion: string): AsyncResult<boolean>;
  /** Records the acknowledgement at `at` (default now). Recording a pair again returns the first record. */
  record(input: {
    readonly featureId: string;
    readonly termsVersion: string;
    readonly at?: number;
    readonly context?: unknown;
  }): AsyncResult<AcknowledgementRecord>;
  /** The latest acknowledgement of the feature, any terms version, or null. */
  latest(featureId: string): AsyncResult<AcknowledgementRecord | null>;
}

export const AcknowledgementStoreToken = createToken<AcknowledgementStore>('core.acknowledgementStore');

/** One setting: its key, its schema and the value it has until the user changes it. */
export interface SettingDefinition<T> {
  readonly key: string;
  readonly schema: ZodType<T>;
  readonly defaultValue: T;
}

const KEY = /^[a-z][a-zA-Z0-9]*([._-][a-zA-Z0-9]+)*$/;

/** Declares a setting once, in the package that owns it. Throws on a bad key or a default the schema rejects (bugs). */
export function defineSetting<T>(key: string, schema: ZodType<T>, defaultValue: T): SettingDefinition<T> {
  if (!KEY.test(key)) throw new Error(`Invalid setting key '${key}'`);
  if (!schema.safeParse(defaultValue).success) throw new Error(`Default for '${key}' fails its schema`);
  return { key, schema, defaultValue };
}

export interface SettingsStore {
  /** The stored value, or the default when unset or when what is stored no longer fits the schema. */
  get<T>(setting: SettingDefinition<T>): AsyncResult<T>;
  /**
   * Validates against the setting's schema (ValidationError naming the key) and stores the parsed value.
   * A command handler passes its `context`: the write then commits with the command's audit row, or not
   * at all (the library stages it in the command's unit of work). Without one it is written now.
   */
  set<T>(setting: SettingDefinition<T>, value: T, context?: CommandContext): AsyncResult<T>;
  /** Back to the default; `context` as for set. */
  reset(setting: SettingDefinition<unknown>, context?: CommandContext): AsyncResult<void>;
}

export const SettingsStoreToken = createToken<SettingsStore>('core.settingsStore');

/** An in-memory SettingsStore for tests: the reference for the semantics above (it writes at once, context or not). */
export function createMemorySettingsStore(): SettingsStore {
  const values = new Map<string, unknown>();
  return {
    async get<T>(setting: SettingDefinition<T>) {
      const parsed = setting.schema.safeParse(values.get(setting.key));
      return ok(values.has(setting.key) && parsed.success ? parsed.data : setting.defaultValue);
    },
    async set<T>(setting: SettingDefinition<T>, value: T) {
      const parsed = setting.schema.safeParse(value);
      if (!parsed.success)
        return err(ValidationError({ field: setting.key }, { detail: parsed.error.message }));
      values.set(setting.key, structuredClone(parsed.data));
      return ok(parsed.data);
    },
    async reset(setting) {
      values.delete(setting.key);
      return ok(undefined);
    },
  };
}
