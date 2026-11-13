// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a USB import adds to the hand-off (P3-B4, P3-B5): where the item came from (the run, the bridge, the
 * device and its key for the item, the album, the device's date) and the hashes the pull checked, as the asset's
 * import record (`usb_imports`, migration 23). One row per device item: importing the same item again (a second
 * run, a run resumed after a crash) points it at the asset it became this time.
 */
import type { AssetId, StagedImport, UsbImportFacts } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { LocationVia } from '../schema/library';
import { usbImports } from '../schema/library';

/** The facts of a USB item, or null for a Wi-Fi upload (and a USB journal written without them). */
export function usbFactsOf(file: StagedImport): UsbImportFacts | null {
  return file.channel === 'usb' ? (file.usb ?? null) : null;
}

/** How the import's location was found: by the phone's browser, or pulled over the cable. */
export const viaOf = (file: StagedImport): LocationVia => file.channel;

/** Writes (or re-points) the item's import record. Runs inside the import's transaction. */
export function recordUsbImport(
  db: LibraryDatabase,
  file: StagedImport,
  assetId: AssetId,
  now: number,
): void {
  const usb = usbFactsOf(file);
  if (!usb) return;
  const changes = {
    assetId,
    runId: usb.runId,
    bridge: usb.bridge,
    deviceCreatedAt: usb.createdAt,
    album: usb.album,
    sha256: usb.sha256,
    sourceSha256: usb.sourceSha256,
    importedAt: now,
  };
  db.orm
    .insert(usbImports)
    .values({ deviceKey: usb.deviceKey, itemKey: usb.itemKey, ...changes })
    .onConflictDoUpdate({ target: [usbImports.deviceKey, usbImports.itemKey], set: changes })
    .run();
}
