// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createSerialQueue,
  defineSetting,
  err,
  ok,
  pluginConfigSchema,
  publicErrorSchema,
  type PluginSecrets,
  type SettingsStore,
} from '@taalcut/core';
import { z } from 'zod';
import { PluginInvalidInput } from './errors';
import type { PluginData } from './provider';

const stateSchema = z.object({
  enabled: z.boolean(),
  config: pluginConfigSchema,
  grantedAccess: z.array(z.string()),
  setupRequested: z.boolean(),
  lastCheckedAt: z.number().nullable(),
  error: publicErrorSchema.optional(),
  defaultsApplied: z.boolean().optional(),
});
export type PluginRecord = z.output<typeof stateSchema>;

export function pluginStateSetting(
  pluginId: string,
  config: Record<string, string>,
  defaultAccess: readonly string[] = [],
) {
  return defineSetting(`plugins.${pluginId}.state`, stateSchema, {
    enabled: true,
    config,
    grantedAccess: [...defaultAccess],
    setupRequested: false,
    lastCheckedAt: null,
    defaultsApplied: true,
  });
}

export function createPluginStateStore(
  pluginId: string,
  config: Record<string, string>,
  defaultAccess: readonly string[],
  store: SettingsStore,
) {
  const setting = pluginStateSetting(pluginId, config, defaultAccess);
  const save = (value: PluginRecord) => store.set(setting, { ...value, defaultsApplied: true });
  return {
    save,
    async get() {
      const current = await store.get(setting);
      if (!current.ok || current.value.defaultsApplied) return current;
      const upgraded: PluginRecord = {
        ...current.value,
        enabled: true,
        grantedAccess:
          current.value.grantedAccess.length > 0 ? current.value.grantedAccess : [...defaultAccess],
        defaultsApplied: true,
      };
      const saved = await save(upgraded);
      return saved.ok ? ok(upgraded) : saved;
    },
  };
}

export function scopedPluginSecrets(pluginId: string, ids: readonly string[], store: PluginSecrets) {
  const key = (id: string) => `plugins.${pluginId}.${id}`;
  return {
    get: (id: string) =>
      ids.includes(id) ? store.get(key(id)) : Promise.resolve(err(PluginInvalidInput({ pluginId }))),
    set: (id: string, value: string) =>
      ids.includes(id) ? store.set(key(id), value) : Promise.resolve(err(PluginInvalidInput({ pluginId }))),
    delete: (id: string) =>
      ids.includes(id) ? store.delete(key(id)) : Promise.resolve(err(PluginInvalidInput({ pluginId }))),
  } satisfies PluginSecrets;
}

const dataKey = /^[a-zA-Z0-9_-]{1,100}$/;
export function scopedPluginData(pluginId: string, store: SettingsStore): PluginData {
  const setting = defineSetting(`plugins.${pluginId}.data`, z.record(z.string(), z.json()), {});
  /** Changes one at a time, each from what the one before saved. */
  const changes = createSerialQueue();
  const invalid = () => err(PluginInvalidInput({ pluginId }));
  const mutate = (key: string, value: unknown, remove: boolean) =>
    changes.run(async () => {
      if (!dataKey.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) return invalid();
      const parsed = z.json().safeParse(value);
      if (!remove && (!parsed.success || JSON.stringify(parsed.data).length > 100_000)) return invalid();
      const current = await store.get(setting);
      if (!current.ok) return current;
      const next = { ...current.value };
      if (remove) delete next[key];
      else if (parsed.success) next[key] = parsed.data;
      if (JSON.stringify(next).length > 1_000_000) return invalid();
      const saved = await store.set(setting, next);
      return saved.ok ? ok(undefined) : saved;
    });
  return {
    async get(key) {
      if (!dataKey.test(key)) return invalid();
      const result = await store.get(setting);
      return result.ok ? ok(Object.hasOwn(result.value, key) ? result.value[key] : undefined) : result;
    },
    set: (key, value) => mutate(key, value, false),
    delete: (key) => mutate(key, null, true),
    clear: () => changes.run(() => store.reset(setting)),
  };
}
