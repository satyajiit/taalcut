// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which local model describes clips here (LIB1-FIX), so a description waits for the bundled model only when that
 * model is the one that describes. A local description walks the vision module's chain on this Mac (the agent's
 * background models): the bundled runtime (`on-device`) and any server of the person's own on this computer
 * (Ollama, LM Studio). A missing bundled runtime falls through to the next local choice, so with the person's own
 * server in the chain their descriptions never wait for a download they may never start. With no local choice a
 * description skips once (`no_local_model`) and doesn't wait either.
 *
 * The jobs process reads the chain the agent saves (the profile store in the library) and the servers' addresses
 * (Settings › Advanced). It never saves: the agent owns both, and a read here must not migrate a retiring choice.
 */
import { LOCAL_SERVER_KINDS, ok, type ModelProfileStore, type SettingsStore } from '@taalcut/core';
import {
  createModelProfiles,
  isLoopbackUrl,
  LOCAL_RUNTIME_PROVIDER,
  localServerBaseUrl,
} from '@taalcut/models';
import type { Tier } from '@taalcut/vision';
import { LOCAL_SERVERS_SETTING } from '../../shared/account-settings';

/** Who answers a description on this Mac: the bundled model, a server of the person's own, or no local model. */
export type LocalDescriber = 'bundled' | 'own-server' | 'none';

const OWN_SERVERS: ReadonlySet<string> = new Set(LOCAL_SERVER_KINDS);

/**
 * The vision chain's providers, in order, and the person's servers that run on this computer. Their own server
 * anywhere in the chain describes (the bundled one first falls through to it while it isn't installed).
 */
export function localDescriber(
  providers: readonly string[],
  localServers: ReadonlySet<string>,
): LocalDescriber {
  if (providers.some((provider) => OWN_SERVERS.has(provider) && localServers.has(provider)))
    return 'own-server';
  return providers.includes(LOCAL_RUNTIME_PROVIDER) ? 'bundled' : 'none';
}

/** The servers saved with an address on this computer (a LAN box is not local, so never takes a local call). */
export async function localServersOf(settings: Pick<SettingsStore, 'get'>): Promise<ReadonlySet<string>> {
  const saved = await settings.get(LOCAL_SERVERS_SETTING);
  if (!saved.ok) return new Set();
  const urls: Readonly<Record<string, string | undefined>> = saved.value;
  return new Set(
    LOCAL_SERVER_KINDS.filter((kind) => {
      const url = urls[kind];
      return url !== undefined && isLoopbackUrl(localServerBaseUrl(url));
    }),
  );
}

/**
 * Reads who describes for a tier: the vision chain as the agent resolves it (profile, overrides, the tier's local
 * models). Undefined when the profiles can't be read: the caller keeps waiting for the bundled model, as before.
 */
export function describerReader(
  store: ModelProfileStore,
  settings: Pick<SettingsStore, 'get'>,
): (tier: Tier) => Promise<LocalDescriber | undefined> {
  const readOnly: ModelProfileStore = { load: () => store.load(), save: async () => ok(undefined) };
  return async (tier) => {
    const profiles = createModelProfiles({ store: readOnly, tier });
    const loaded = await profiles.load();
    if (!loaded.ok) return undefined;
    const chain = profiles.resolve('vision');
    const providers = chain.ok ? chain.value.choices.map((choice) => choice.provider) : [];
    return localDescriber(providers, await localServersOf(settings));
  };
}
