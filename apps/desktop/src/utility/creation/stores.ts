// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { AuthoredProgramStoreToken, CreationStoreToken, type Container } from '@taalcut/core';
import {
  createAuthoredProgramStore,
  createCreationStore,
  LibraryDatabaseToken,
  LibraryPortsToken,
} from '@taalcut/library';

export function registerCreationStores(container: Container, userData: string): void {
  if (!container.has(LibraryDatabaseToken) || container.has(CreationStoreToken)) return;
  container.factory(
    CreationStoreToken,
    ({ db, ports }) => createCreationStore(db, { commands: ports.commands }),
    {
      deps: { db: LibraryDatabaseToken, ports: LibraryPortsToken },
    },
  );
  container.factory(
    AuthoredProgramStoreToken,
    ({ db, ports }) =>
      createAuthoredProgramStore(db, {
        dataRoot: userData,
        commands: ports.commands,
      }),
    { deps: { db: LibraryDatabaseToken, ports: LibraryPortsToken } },
  );
}
