// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sources (P1-G7, P2-L2): the library commands, folder checks, the scanner,
 * watcher, relink and hashing jobs, volumes and placeholders, and the
 * library's agent tools.
 */
export {
  ADD_SOURCE,
  addSourcePayload,
  createSourceCommands,
  MAX_SOURCES,
  REMOVE_SOURCE,
  removeSourcePayload,
  sourceInfo,
  type SourceCommandDeps,
  type SourceInfo,
} from './commands';
export {
  createLibraryCommands,
  ORIGINALS_ROOT_SETTING,
  originalsRootOf,
  type LibraryCommandDeps,
} from './library-commands';
export {
  FolderMissing,
  FolderNotAllowed,
  folderParams,
  FolderPermissionDenied,
  NotAFolder,
  OriginalUnavailable,
  RelinkMismatch,
  TooManySources,
} from './errors';
export { normaliseFolderPath, resolveFolder, type FolderPolicy } from './folders';
export {
  listMediaFiles,
  mediaTypeOf,
  type MediaFile,
  type MediaFileType,
  type MediaListing,
} from './media-files';
export { BUNDLE_EXTENSIONS, compareRelative, isScannable, walkMedia, type WalkEntry } from './walk';
export {
  createLinuxVolumeProbe,
  mountFor,
  parseMountInfo,
  procMountSources,
  type LinuxMountSources,
  type MountRow,
} from './linux-volumes';
export {
  createDeviceVolumeProbe,
  createMacVolumeProbe,
  createVolumeProbe,
  isPlaceholder,
  PLACEHOLDER_MIN_BYTES,
  type PlaceholderStatus,
  type VolumeInfo,
  type VolumeProbe,
} from './volumes';
export {
  collectJob,
  findMissingFilesJob,
  hashAssetJob,
  scanKey,
  scanSourceJob,
  sweepStagingJob,
  type ScanSourceInput,
} from './job-kinds';
export { enqueueInTransaction, enqueueScan, type EnqueueRequest } from './enqueue';
export { scanSource, type ScanCounts, type ScanDeps, type ScanEnd, type ScanRequest } from './scanner';
export { hashAsset, libraryHashStage, mergeInto, type HashAssetDeps } from './hash-asset';
export { findMissingFiles, MAX_MISSING_CANDIDATES, type MissingCandidate } from './find-missing';
export { collect, DETACHED_RETENTION_MS, type CollectDeps } from './collect';
export {
  createFolderWatcher,
  DEFAULT_WATCH_TIMINGS,
  fsWatchBackend,
  type FolderWatcher,
  type FolderWatcherDeps,
  type WatchBackend,
  type WatchHandle,
  type WatchTimings,
} from './watcher';
export { createLibraryJobs, type LibraryJobDeps } from './jobs';
export {
  folderKey,
  libraryToolModule,
  type AssetContactSheetReader,
  type ContactSheetPictures,
  type LibraryToolDeps,
} from './tools';
