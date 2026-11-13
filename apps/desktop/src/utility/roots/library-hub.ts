// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hub client's storage in the agent process (P3-B12, P3-V8): the library's HubIndexCache and
 * HubSubmissionStore by core's tokens, lazy. A submission recorded with hub.publish's context commits with its
 * audit row (the library ports' unit of work). agent-templates-hub.ts serves `hub` once both resolve.
 */
import { HubIndexCacheToken, HubSubmissionStoreToken, type Container } from '@taalcut/core';
import { createHubIndexCache, createHubSubmissionStore } from '@taalcut/library';
import { LibraryDatabaseToken, LibraryPortsToken } from '../../shared/tokens';

export function registerLibraryHub(container: Container): void {
  container
    .factory(HubIndexCacheToken, ({ db }) => createHubIndexCache(db), { deps: { db: LibraryDatabaseToken } })
    .factory(
      HubSubmissionStoreToken,
      ({ db, ports }) => createHubSubmissionStore(db, { commands: ports.commands }),
      { deps: { db: LibraryDatabaseToken, ports: LibraryPortsToken } },
    );
}
