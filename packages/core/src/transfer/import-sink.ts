// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hand-off from phone import to the library (P2-L10 Wi-Fi, P3-B4 and
 * P3-B5 USB): transfer stages each finished file and the library imports
 * it. The library implements ImportSink in the lan process.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type AssetId, type SourceId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { reencodeCheckSchema } from '../library/library-types';
import { DEVICE_BRIDGE_KINDS, deviceItemKeySchema, deviceKeySchema } from './devices-contract';
import { TRANSFER_PLATFORMS } from './transfer-platforms';

export const IMPORT_CHANNELS = ['wifi', 'usb', 'local', 'camera', 'photos'] as const;
export type ImportChannel = (typeof IMPORT_CHANNELS)[number];

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * What a USB item adds. For a USB item `sessionId` is the run's own TransferSessionId (one usb_import Source per
 * run, named after the device), `uploadId` is minted per item and `device.id` is kept per device key.
 */
export const usbImportFactsSchema = z.object({
  runId: idSchema<'DeviceImportRun'>(),
  bridge: z.enum(DEVICE_BRIDGE_KINDS),
  deviceKey: deviceKeySchema,
  itemKey: deviceItemKeySchema,
  /** The device's creation date for the item, when it gave one. */
  createdAt: z.int().nonnegative().nullable(),
  album: z.string().max(120).nullable(),
  /** SHA-256 of the staged bytes, computed while pulling. */
  sha256: sha256Hex,
  /** The same hash computed on the device, when the bridge can. */
  sourceSha256: sha256Hex.nullable(),
});
export type UsbImportFacts = z.output<typeof usbImportFactsSchema>;

/** One finished upload waiting in the staging folder; also the journal file's schema (<uploadId>.import.json). */
export const stagedImportSchema = z.object({
  sessionId: idSchema<'TransferSession'>(),
  uploadId: idSchema<'TransferUpload'>(),
  /** The staged bytes, inside staging().dir. */
  path: z.string().min(1).max(4096),
  /** Other files of this upload in the staging folder (the tus info file), deleted after the import. */
  companions: z.array(z.string().min(1).max(4096)).max(4),
  fileName: z.string().min(1).max(255),
  sizeBytes: z.int().nonnegative(),
  mimeType: z.string().max(100).nullable(),
  /** The phone's File.lastModified. */
  lastModified: z.int().nonnegative().nullable(),
  source: z
    .object({ label: z.string().min(1).max(1024), externalId: z.string().max(4096).optional() })
    .optional(),
  device: z
    .object({
      id: idSchema<'TransferDevice'>(),
      label: z.string().max(60),
      platform: z.enum(TRANSFER_PLATFORMS),
    })
    .optional(),
  reencode: reencodeCheckSchema,
  receivedAt: z.int().nonnegative(),
  /** P3: how it came; journals written before USB import read as Wi-Fi. */
  channel: z.enum(IMPORT_CHANNELS).default('wifi'),
  usb: usbImportFactsSchema.optional(),
});
export type StagedImport = z.output<typeof stagedImportSchema>;

export interface ImportOutcome {
  readonly assetId: AssetId;
  /** The session's wifi_import source, or the run's usb_import source. */
  readonly sourceId: SourceId;
  /** ADR 0001: a referenced-only asset gains this as its managed copy; one with a managed copy drops it. */
  readonly duplicate: 'none' | 'added-managed-copy' | 'already-in-library';
}

/** One shared destination-space budget across transport processes. Owners are stable upload IDs. */
export interface ImportSpacePort {
  reserve(owner: string, bytes: number): AsyncResult<void>;
  consume(owner: string, bytes: number): void;
  release(owner: string): void;
}

export interface ImportSink {
  /** Hold the managed destination against eject until all caller reads/writes settle. In-process only. */
  retainDestination?(owner: string): AsyncResult<() => void>;
  readonly space?: ImportSpacePort;
  /** The staging folder on the originals root's volume (so the final move is a rename); fails when it is unplugged. */
  staging(): AsyncResult<{
    readonly dir: string;
    readonly freeBytes: number;
    readonly volumeName: string | null;
  }>;
  /** Hashes, de-duplicates, moves into the originals root and records the asset. Idempotent per uploadId. */
  importStaged(file: StagedImport, options?: { readonly signal?: AbortSignal }): AsyncResult<ImportOutcome>;
  /**
   * Of these assets, the ones the library still has and hasn't trashed (USB "Only new"). P3: optional until the
   * library implements it; the devices lane treats its absence as "none known".
   */
  knownAssets?(ids: readonly AssetId[]): AsyncResult<ReadonlySet<AssetId>>;
}

export const ImportSinkToken = createToken<ImportSink>('core.importSink');
