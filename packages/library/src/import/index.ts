// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The library side of the Wi-Fi and USB hand-offs (P2-L3, P3-B4): core's ImportSink and the staging sweep. */
export { OriginalsOffline } from './errors';
export { datedFolder, freeName, sanitiseFileName } from './file-names';
export {
  createImportSink,
  STAGING_FOLDER,
  type ImportSinkOptions,
  type LibraryImportSink,
} from './import-sink';
export { knownAssets } from './known-assets';
export { STAGING_RETENTION_MS, sweepStaging } from './sweep';
export * from './local';
export type { ImportSinkSpaceCoordinator } from './space';
