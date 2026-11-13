// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bring-your-own local servers (Settings → Advanced): their base URLs,
 * which aren't secret, in the library's settings table. Main writes them
 * through models' accounts service; the agent registers them as providers.
 * Keys and tokens live in the keychain vault, never here.
 */
import { defineSetting, LOCAL_SERVER_KINDS, ok, type SettingsStore } from '@taalcut/core';
import {
  localServerEndpoint,
  type LocalServerStore,
  type LocalServerUrls,
  type ModelRuntime,
} from '@taalcut/models';
import { z } from 'zod';

export const LOCAL_SERVERS_SETTING = defineSetting(
  'accounts.localServers',
  z.partialRecord(z.enum(LOCAL_SERVER_KINDS), z.url()),
  {},
);

/** models' LocalServerStore over the settings table; `saved` runs after each save. */
export function settingsLocalServerStore(settings: SettingsStore, saved?: () => void): LocalServerStore {
  return {
    load: () => settings.get(LOCAL_SERVERS_SETTING),
    async save(urls: LocalServerUrls) {
      const written = await settings.set(LOCAL_SERVERS_SETTING, { ...urls });
      if (!written.ok) return written;
      saved?.();
      return ok(undefined);
    },
  };
}

/** Registers the saved servers on `runtime` and removes the others (the agent's copy of main's list). */
export async function syncLocalServers(runtime: ModelRuntime, settings: SettingsStore): Promise<void> {
  const saved = await settings.get(LOCAL_SERVERS_SETTING);
  if (!saved.ok) console.warn(`[models] local servers not read: ${saved.error.code}`);
  const urls = saved.ok ? saved.value : {};
  for (const kind of LOCAL_SERVER_KINDS) {
    const url = urls[kind];
    if (!url) {
      runtime.removeEndpoint(kind);
      continue;
    }
    const set = runtime.setEndpoint(localServerEndpoint(kind, url));
    if (!set.ok) console.warn(`[models] local server ${kind} not registered: ${set.error.code}`);
  }
}
