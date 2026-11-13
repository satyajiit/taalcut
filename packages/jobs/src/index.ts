// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/jobs: the durable job engine (G7) and the component and model
 * download manager (G13). Framework-free; runs in the jobs utility process.
 *
 * This file is the package's only public entry point. See SPEC.md.
 */

// Component manifest (tools/components/).
export {
  ARCHIVE_FORMATS,
  COMPONENT_KINDS,
  ComponentManifestSchema,
  HARDWARE_TIERS,
  isAllowedDownloadUrl,
  manifestJsonSchema,
  MAX_NOTICE_BYTES,
  parseManifest,
  PLATFORM_KEYS,
  requiresAttribution,
  type ArchiveFormat,
  type ComponentArtifact,
  type ComponentEntry,
  type ComponentKind,
  type ComponentLicence,
  type ComponentLicenceNotice,
  type ComponentManifest,
  type HardwareTier,
  type InstallSpec,
  type LicenceAcceptance,
  type PlatformKey,
} from './components/manifest';
export { LicenceAcceptanceSchema } from './components/acceptance';
// Terms the person accepts before a component downloads (LNX1-TRM).
export {
  refuseUnaccepted,
  termsHolds,
  termsReason,
  unacceptedTerms,
  type TermsBook,
  type TermsHold,
} from './components/terms';
// Signed manifest delivery: pinned keys, verification, anti-rollback.
export {
  DEVELOPMENT_MANIFEST_KEY,
  MAX_TRUSTED_KEYS,
  TRUSTED_MANIFEST_KEYS,
  type TrustedKey,
} from './components/trusted-keys';
export { canonicalJson, keyIdOf, SIGNATURE_CONTEXT, signedMessage } from './components/signing/canonical';
export { verifySignedManifest, type VerifiedManifest, type VerifyOptions } from './components/signing/verify';
export { loadSignedManifest, type LoadSignedManifestOptions } from './components/signing/load';
export {
  chooseVariant,
  componentsForTier,
  currentPlatform,
  dependentsOf,
  installIdempotencyKey,
  installOrder,
  selectArtifact,
  tierPicks,
} from './components/selection';
// What a component needs of the machine (LNX1 seam 4).
export { ComponentRequiresSchema, KNOWN_REQUIREMENTS, type ComponentRequires } from './components/requires';
export {
  compareVersions,
  machineFit,
  type MachineDescription,
  type MachineFitResult,
  type MachineGpu,
} from './components/machine-fit';

// Errors.
export {
  ChecksumMismatch,
  ComponentRequired,
  ComponentUnknown,
  DiskSpaceLow,
  DownloadFailed,
  DownloadRejected,
  DownloadsSpaceLow,
  ExtractFailed,
  InstallFailed,
  ManifestInvalid,
  ManifestUntrusted,
  type ManifestRefusal,
  OPEN_STORAGE_SETTINGS,
  PlatformUnsupported,
  SizeMismatch,
  TermsNotAccepted,
} from './components/errors';

// Manager.
export {
  createComponentManager,
  type ComponentManager,
  type ComponentManagerOptions,
  type ComponentState,
  type ComponentStatus,
  type InstallOptions,
  type InstallPlan,
  type InstalledComponent,
  type SpaceCheck,
} from './components/manager';
export {
  COMPONENT_PHASES,
  type ComponentPhase,
  type ComponentProgress,
  type ProgressListener,
} from './components/progress';
export { installedComponentDirSync } from './components/registry';
// The download of everything this Mac needs (UX2-DOWNLOADER).
export {
  createDownloadSet,
  type DownloadSet,
  type DownloadSetOptions,
  type MachineFit,
} from './components/downloads/set';
export {
  type AwaitingTerms,
  type DownloadSetEntry,
  type DownloadSetState,
  type DownloadSetStatus,
  type SetEntryState,
} from './components/downloads/report';
export { downloadOrder, neededComponents } from './components/downloads/order';
export { describeChoices, misfit, type TermsRule } from './components/downloads/choices';
export {
  planSet,
  variantHere,
  type HeldBack,
  type SelectionInput,
  type SetPlan,
} from './components/downloads/plan';
export { DEFAULT_HEADROOM_BYTES, nodeStatfs, type StatfsLike } from './components/disk';
export type { FetchInit, FetchLike } from './components/http';
export { DEFAULT_DOWNLOAD_RETRY, type RetryPolicy } from './components/retry';
export { sha256File } from './components/fs-util';

// Durable job engine (src/queue/).
export * from './queue';
export { nextScheduleOccurrence, InvalidSchedule, type CalendarSchedule } from './schedules/recurrence';
export { createProductScheduler, type ProductSchedulerDeps } from './schedules/product-scheduler';
