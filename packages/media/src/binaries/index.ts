// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export {
  createBinaryResolver,
  describeBinary,
  FFMPEG_DIR_ENV,
  type BinaryResolver,
  type BinaryResolverOptions,
  type BinarySource,
  type FfmpegBinaries,
  type ResolvedFfmpeg,
} from './resolver';
export { classifyLicence, isLgpl, type BuildInfo, type FfmpegLicence } from './build-info';
export {
  BUILDINFO_FILE,
  BUNDLED_FFMPEG_VERSION,
  MOLTENVK_ICD,
  type BuildMismatchReason,
  type BundledBuild,
} from './bundled-build';
export {
  bundleFiles,
  FFMPEG_BUILD_TARGET_IDS,
  FFMPEG_BUILD_TARGETS,
  ffmpegBuildTarget,
  shipsVulkanDriver,
  PINNED_FFMPEG_BUILD,
  type BuildFile,
  type FfmpegBuildTarget,
  type FfmpegBuildTargetId,
  type PinnedFfmpegBuild,
} from './build-targets';
export { pinBuild } from './pinned-build';
export { signatureFreeDigest, signatureFreeSha256 } from './macho-digest';
