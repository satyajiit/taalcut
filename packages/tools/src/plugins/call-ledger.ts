// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createSerialQueue,
  defineSetting,
  err,
  ok,
  type AsyncResult,
  type Result,
  type SettingsStore,
} from '@taalcut/core';
import { z } from 'zod';
import { contentHash } from '../hash';
import { PluginInvalidInput, PluginRemoteFailed } from './errors';

const entry = z.object({ hash: z.string(), done: z.boolean(), value: z.json().optional() });
type Reservation = { fresh: true } | { fresh: false; value: unknown };

/** Reserve before sending: an uncertain external result must not be published a second time. */
export function createPluginCallLedger(pluginId: string, settings: SettingsStore) {
  const setting = defineSetting(`plugins.${pluginId}.calls`, z.record(z.string(), entry), {});
  const turns = createSerialQueue();
  return {
    reserve(key: string, input: unknown): AsyncResult<Reservation> {
      return turns.run<Result<Reservation>>(async () => {
        const current = await settings.get(setting);
        if (!current.ok) return current;
        const digest = contentHash(key);
        const hash = contentHash(input);
        const previous = current.value[digest];
        if (previous) {
          if (previous.hash !== hash) return err(PluginInvalidInput({ pluginId }));
          if (previous.done && previous.value !== undefined)
            return ok({ fresh: false, value: previous.value });
          return err(PluginRemoteFailed({ pluginId }));
        }
        // Keep uncertain reservations; only completed calls can be evicted.
        const entries = Object.entries(current.value);
        if (entries.length >= 256) {
          const evict = entries.find(([_, item]) => item.done);
          if (!evict) return err(PluginRemoteFailed({ pluginId }));
          delete current.value[evict[0]];
        }
        const saved = await settings.set(setting, { ...current.value, [digest]: { hash, done: false } });
        return saved.ok ? ok({ fresh: true }) : saved;
      });
    },
    finish(key: string, value: unknown): AsyncResult<void> {
      return turns.run(async () => {
        const current = await settings.get(setting);
        if (!current.ok) return current;
        const digest = contentHash(key);
        const previous = current.value[digest];
        if (!previous) return ok(undefined);
        const parsed = z.json().safeParse(value);
        const safe = parsed.success && JSON.stringify(parsed.data).length <= 32_000 ? parsed.data : undefined;
        const saved = await settings.set(setting, {
          ...current.value,
          [digest]: { hash: previous.hash, done: true, ...(safe === undefined ? {} : { value: safe }) },
        });
        return saved.ok ? ok(undefined) : saved;
      });
    },
    clear: () => turns.run(() => settings.reset(setting)),
  };
}
