// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The languages you speak, in the agent process (LIB1-LANG): `settings.setSpokenLanguages` on the bus and
 * `appContract.speech` (the stored list, null until the person answers). Indexing in the jobs process reads the same
 * setting from the same store, per job, as a prior for spoken-language detection.
 */
import {
  createSpokenLanguageCommands,
  implementContract,
  SettingsStoreToken,
  speechContract,
  SPOKEN_LANGUAGES_SETTING,
  unwrapRpc,
  type AnyCommand,
  type Container,
} from '@taalcut/core';

export function spokenLanguageCommands(container: Container): AnyCommand[] {
  return createSpokenLanguageCommands({ settings: container.resolve(SettingsStoreToken) })
    .all as AnyCommand[];
}

export function speechRouter(container: Container) {
  const settings = container.resolve(SettingsStoreToken);
  const os = implementContract(speechContract);
  return os.router({
    spokenLanguages: os.spokenLanguages.handler(async () => ({
      languages: unwrapRpc(await settings.get(SPOKEN_LANGUAGES_SETTING)),
    })),
  });
}
