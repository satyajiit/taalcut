// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createToken,
  EventBusToken,
  LOCAL_ONLY_SETTING,
  SettingsStoreToken,
  type Container,
  type ImportSource,
  err,
  NotFoundError,
  newId,
} from '@taalcut/core';
import {
  createImportSessionService,
  createLocalImportAdapter,
  createImportSink,
  createImportSpaceCoordinator,
  createImportReaderRegistry,
  createSettingsRepository,
  importsControlRouter,
  importsRouter,
  originalsRootOf,
} from '@taalcut/library';
import { PlatformServicesToken } from '../../platform';
import { mountedEjectVolumes } from '../../platform/mounted-media';
import { LibraryDatabaseToken } from '../../shared/tokens';
import type { UtilityHost } from '../rpc/utility-host';
import { createImportPreviewHandler } from '../protocol/import-previews';
import { resolveImportPreview, renderPhotosImportPreview } from './preview-source';
import { createImportPreviewMedia } from './preview-media';
import { createBackgroundTransferOwner } from '../transfer/background-transfer';
import { trackDevicesWatch, watchLanDevices } from '../transfer/lan-bridge';
import type { LanLifecycle } from '../transfer/lan-lifecycle';
import { localImportPicker } from './local-picker';
import { createPhotosHost } from './photos-host';
import { createPhotosImportAdapter } from './photos-adapter';
import { createPhoneImportAdapter, phoneImportSources } from './phone-adapter';

export const ImportRuntimeToken =
  createToken<ReturnType<typeof createDesktopImports>>('desktop.importRuntime');

export function createDesktopImports(
  container: Container,
  options: {
    readonly runtime: { readonly packaged: boolean };
    readonly resourcesPath: string;
    readonly userData: string;
  },
  host: UtilityHost,
  lan?: Pick<LanLifecycle, 'onTransferCall' | 'onDevicesWatch'>,
) {
  const db = container.resolve(LibraryDatabaseToken);
  // Only main owns these local-copy leases; a previous process is gone before main opens this library.
  db.driver.exec(
    `DELETE FROM import_capture_locks;
     DELETE FROM import_volume_barriers;
     DELETE FROM import_volume_readers;
     DELETE FROM import_space_reservations;
     DELETE FROM import_drafts
     WHERE json_extract(body, '$.method') = 'phone-cable'
       AND json_extract(body, '$.sessionId') IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM import_draft_items
         WHERE import_draft_items.draft_id = import_drafts.id
           AND instr(json_extract(import_draft_items.body, '$.name'), '/') > 0
       );`,
  );
  const settings = container.resolve(SettingsStoreToken);
  const originalsRoot = () =>
    originalsRootOf({ settings, defaultOriginalsRoot: join(homedir(), 'Movies', 'Taalcut', 'Originals') });
  const platform = container.resolve(PlatformServicesToken);
  const volumes = platform.volumeProbe();
  const events = container.resolve(EventBusToken);
  const readers = createImportReaderRegistry(db);
  const mounted = platform.mountedMedia();
  const previewMedia = createImportPreviewMedia({
    db,
    volumes,
    packaged: options.runtime.packaged,
    resourcesPath: options.resourcesPath,
  });
  const local = createLocalImportAdapter({
    db,
    originalsRoot,
    volumes,
    events,
    pick: localImportPicker(mounted),
    thumbnailUrl: (id) => `app://media/import-preview/${id}.jpg`,
    inspectCapture: previewMedia.inspect,
  });
  const localOnly = () => {
    const value = createSettingsRepository(db).get(LOCAL_ONLY_SETTING.key, LOCAL_ONLY_SETTING.schema);
    return !value.ok || value.value === true;
  };
  const photos = createPhotosHost({
    packaged: options.runtime.packaged,
    resourcesPath: options.resourcesPath,
    originalsRoot,
    localOnly,
    readLease: () => readers.acquire(newId<'ImportReader'>(), '*'),
  });
  const previews = createImportPreviewHandler({
    rootDir: join(options.userData, 'import-previews'),
    resolve: (id) => resolveImportPreview(db, id),
    render: (source, dest, signal) =>
      source.method === 'photos'
        ? renderPhotosImportPreview(photos, source.locator, dest, signal)
        : previewMedia.render(source, dest, signal),
  });
  const devicesNote = lan ? trackDevicesWatch((open) => lan.onDevicesWatch(open)) : undefined;
  const transfer = () => {
    if (lan) lan.onTransferCall();
    else host.start('lan');
    const raw = host.client('lan');
    const client = devicesNote ? watchLanDevices(raw, devicesNote) : raw;
    return client.transfer;
  };
  const phone = createPhoneImportAdapter({
    transfer,
    destinationLabel: originalsRoot,
  });
  const reception = createBackgroundTransferOwner();
  const space = createImportSpaceCoordinator(db);
  const service = createImportSessionService({
    db,
    async ejectSource(sourceId) {
      const available = await mounted.list();
      if (!available.ok) return available;
      const source = available.value.find((media) => media.id === sourceId);
      if (!source) return err(NotFoundError({ entity: 'mountedMedia', id: sourceId }));
      const siblings = mountedEjectVolumes(source, available.value);
      return readers.ejectVolumes(siblings, () => mounted.eject(source));
    },
    adapters: {
      files: local,
      folder: local,
      camera: local,
      dji: local,
      insta360: local,
      'phone-cable': phone,
      ...(platform.abilities.photosImport
        ? {
            photos: createPhotosImportAdapter({
              db,
              photos,
              sink: (root: string) => createImportSink(db, { originalsRoot: root, volumes, events, space }),
              space,
              originalsRoot,
              volumes,
              localOnly,
            }),
          }
        : {}),
    },
  });
  const offSession = events.on('transfer.session', (event) => service.projectTransferSession(event.payload));
  const offFile = events.on('transfer.file', (event) => service.projectTransferFile(event.payload));
  const offLibrary = events.on('library.changed', () => service.refresh());
  const sources = async (): Promise<ImportSource[]> => {
    const output: ImportSource[] = [
      { id: 'files', method: 'files', label: 'Files', available: true, status: null },
      { id: 'folder', method: 'folder', label: 'Folders', available: true, status: null },
      { id: 'phone-wifi', method: 'phone-wifi', label: 'Wi-Fi', available: true, status: null },
    ];
    const mounts = await mounted.list();
    if (mounts.ok)
      for (const media of mounts.value) {
        for (const method of ['camera', 'dji', 'insta360'] as const)
          output.push({ id: media.id, method, label: media.label, available: true, status: null });
      }
    const phones = await phoneImportSources(transfer()).catch(() => []);
    output.push(...phones);
    if (platform.abilities.photosImport) {
      const state = await photos.status();
      output.push({
        id: 'photos',
        method: 'photos',
        label: 'Apple Photos',
        available: state.ok,
        status: state.ok ? state.value.authorization : 'unavailable',
      });
    }
    return output;
  };
  return {
    service,
    previews,
    wrapTransferClient: reception.wrap,
    router: importsRouter(service, sources),
    control: importsControlRouter(service),
    async close() {
      await reception.close();
      await service.close();
      await photos.close();
      offSession();
      offFile();
      offLibrary();
    },
  };
}
