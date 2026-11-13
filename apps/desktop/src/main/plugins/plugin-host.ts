// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  LOCAL_ONLY_SETTING,
  type PluginSecrets,
  type PluginService,
  type SettingsStore,
} from '@taalcut/core';
import {
  createComfyUiPluginDefinition,
  createInstagramEditsPluginDefinition,
  createPluginService,
  createPostizPluginDefinition,
  type OpenPluginUpload,
} from '@taalcut/tools';
import type { ResolvePluginMediaPath } from './plugin-uploads';

/** All providers receive scoped storage from the registry. No plugin receives the global vault. */
export function createDesktopPlugins(
  secrets: PluginSecrets,
  settings: SettingsStore,
  openUpload?: OpenPluginUpload,
  resolveMediaPath?: ResolvePluginMediaPath,
): PluginService {
  return createPluginService({
    definitions: [
      createPostizPluginDefinition(openUpload ? { openUpload } : {}),
      createComfyUiPluginDefinition(),
      createInstagramEditsPluginDefinition(resolveMediaPath ? { resolveMediaPath } : {}),
    ],
    secrets,
    settings,
    networkAllowed: async () => {
      const localOnly = await settings.get(LOCAL_ONLY_SETTING);
      return localOnly.ok && !localOnly.value;
    },
  });
}
