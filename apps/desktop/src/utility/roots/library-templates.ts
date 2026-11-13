// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's template-library stores by core's tokens (P3-V14, P3-V10): `TemplateFolderStoreToken` and
 * `StyleStoreToken`, lazy over the process's library connection, their writes staged on the command unit of work.
 * The agent process registers both (templates, styles and hub routers, and the timeline's setStyle); the render
 * process registers them too, for the Style a render draws. Style logos live beside template assets.
 */
import {
  createToken,
  InstagramSavedStoreToken,
  StyleStoreToken,
  TemplateFolderStoreToken,
  type Container,
} from '@taalcut/core';
import {
  createInstagramSavedStore,
  createStyleStore,
  createTemplateFolderStore,
  type LibraryStyleStore,
} from '@taalcut/library';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { styleAssetsDir } from '../../shared/template-assets';
import { LibraryDatabaseToken, LibraryPortsToken } from '../../shared/tokens';

/** The library's Style store itself (StyleStoreToken's), for `library.collect`'s logo prune (`pruneAssets`). */
export const LibraryStyleStoreToken = createToken<LibraryStyleStore>('desktop.libraryStyleStore');

export function registerLibraryTemplateStores(
  container: Container,
  config: Pick<UtilityConfig, 'userData'>,
): void {
  const withPorts = { deps: { db: LibraryDatabaseToken, ports: LibraryPortsToken } };
  container
    .factory(
      LibraryStyleStoreToken,
      ({ db, ports }) =>
        createStyleStore(db, { assetsDir: styleAssetsDir(config.userData), commands: ports.commands }),
      withPorts,
    )
    .factory(StyleStoreToken, ({ styles }) => styles, { deps: { styles: LibraryStyleStoreToken } })
    .factory(
      TemplateFolderStoreToken,
      ({ db, ports }) => createTemplateFolderStore(db, { commands: ports.commands }),
      withPorts,
    )
    .factory(
      InstagramSavedStoreToken,
      ({ db, ports }) => createInstagramSavedStore(db, { commands: ports.commands }),
      withPorts,
    );
}
