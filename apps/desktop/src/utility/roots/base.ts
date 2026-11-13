// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What every utility process registers: its config, this OS's platform
 * services, the clock, its event bus, the library database and library's
 * stores. The database opens
 * lazily, on first resolve: main has already checked and migrated it, so
 * this skips the integrity check and never restores a backup behind main's
 * back.
 */
import {
  ClockToken,
  createContainer,
  createEventBus,
  diagnosticsRouter,
  EventBusToken,
  eventsRouter,
  systemClock,
  type Container,
  type UtilityName,
} from '@taalcut/core';
import { openDatabase } from '@taalcut/library';
import { hostPlatform, PlatformServicesToken, type PlatformServices } from '../../platform';
import { registerLibraryPorts } from '../../shared/library-ports';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { LibraryDatabaseToken, UtilityConfigToken } from '../../shared/tokens';
import { libraryExtensions } from './library-database';

export function createUtilityContainer(
  config: UtilityConfig,
  platform: PlatformServices = hostPlatform(),
): Container {
  const container = createContainer();
  container.value(UtilityConfigToken, config);
  container.value(PlatformServicesToken, platform);
  container.value(ClockToken, systemClock);
  container.factory(EventBusToken, ({ clock }) => createEventBus({ clock }), { deps: { clock: ClockToken } });
  container.factory(
    LibraryDatabaseToken,
    ({ config }) => {
      const opened = openDatabase({
        path: config.dbPath,
        integrityCheck: 'off',
        onCorruption: 'fail',
        extensions: libraryExtensions(config),
      });
      if (!opened.ok)
        throw new Error(`Can't open the library: ${opened.error.code}`, { cause: opened.error });
      return opened.value;
    },
    { deps: { config: UtilityConfigToken }, dispose: (db) => db.close() },
  );
  // Library's stores by their core tokens (AuditLogStoreToken, JobStoreToken, …), all lazy.
  return registerLibraryPorts(container);
}

/** The namespaces every process serves: diagnostics and its event bus. */
export function commonRouters(container: Container, process: UtilityName, pid: number) {
  return {
    diagnostics: diagnosticsRouter({ process, pid, clock: container.resolve(ClockToken) }),
    events: eventsRouter(container.resolve(EventBusToken)),
  };
}
