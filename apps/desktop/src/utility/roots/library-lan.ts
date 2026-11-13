// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library in the LAN process (P2-L3, P3-B4/P3-B5): core's ImportSink,
 * which files each upload the transfer server or a USB run staged into the
 * managed originals root, and answers USB "Only new" (`knownAssets`). The
 * lan root hands it to the transfer service and registers it as
 * ImportSinkToken. The database opens on the first upload, not when the
 * process starts.
 */
import { EventBusToken, type Container } from '@taalcut/core';
import { createImportSink, createImportSpaceCoordinator, type LibraryImportSink } from '@taalcut/library';
import { PlatformServicesToken } from '../../platform';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { originalsRoot } from './library-agent';

export function libraryImportSink(container: Container): LibraryImportSink {
  let sink: LibraryImportSink | undefined;
  const open = (): LibraryImportSink => {
    if (sink) return sink;
    const db = container.resolve(LibraryDatabaseToken);
    sink = createImportSink(db, {
      originalsRoot: async () => originalsRoot(db),
      space: createImportSpaceCoordinator(db),
      events: container.resolve(EventBusToken),
      volumes: container.resolve(PlatformServicesToken).volumeProbe(),
    });
    return sink;
  };
  return {
    retainDestination: (owner) => open().retainDestination!(owner),
    space: {
      reserve: (owner, bytes) => open().space!.reserve(owner, bytes),
      consume: (owner, bytes) => open().space!.consume(owner, bytes),
      release: (owner) => open().space!.release(owner),
    },
    staging: () => open().staging(),
    importStaged: (file, options) => open().importStaged(file, options),
    knownAssets: (ids) => open().knownAssets(ids),
  };
}
