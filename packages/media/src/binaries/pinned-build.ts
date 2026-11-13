// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The FFmpeg build this release ships, pinned in the app's own code (build-targets.ts, one row per platform). A
 * packaged app's sidecars are checked against these hashes, not only against the BUILDINFO.json next to them,
 * which anyone who can replace the binaries can replace as well. The app's code is inside its signature (and the
 * ASAR integrity check); the sidecar folder is not re-checked after install.
 *
 * Update with the build: `pinBuild(dir, target)` prints the values, and test/pinned-build.test.ts fails until
 * they match the committed BUILDINFO.json (and the binaries, when the dist folder has them).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bundleFiles,
  FFMPEG_BUILD_TARGETS,
  type FfmpegBuildTarget,
  type PinnedFfmpegBuild,
} from './build-targets';
import { BUILDINFO_FILE } from './bundled-build';
import { signatureFreeSha256 } from './macho-digest';

export { PINNED_FFMPEG_BUILD, type PinnedFfmpegBuild } from './build-targets';

/**
 * What a build folder hashes to, in the pin's terms. The Vulkan driver only when `withVulkan` (and the target ships
 * one). Default target: the macOS build.
 */
export async function pinBuild(
  dir: string,
  withVulkan = true,
  target: FfmpegBuildTarget = FFMPEG_BUILD_TARGETS['darwin-arm64'],
): Promise<PinnedFfmpegBuild> {
  const buildInfo = createHash('sha256')
    .update(await readFile(join(dir, BUILDINFO_FILE)))
    .digest('hex');
  const outputs: Record<string, string> = {};
  for (const [name, relative] of bundleFiles(target, withVulkan)) {
    outputs[name] = await signatureFreeSha256(join(dir, relative));
  }
  return { buildInfo, outputs };
}

/**
 * The first difference between `dir` and the pin, or undefined. Hashes only;
 * nothing in `dir` is run. `buildInfoSha256` is the BUILDINFO.json just read.
 */
export async function findPinMismatch(
  dir: string,
  pin: PinnedFfmpegBuild,
  buildInfoSha256: string,
  target: FfmpegBuildTarget,
  withVulkan: boolean,
): Promise<string | undefined> {
  if (buildInfoSha256 !== pin.buildInfo) {
    return `${BUILDINFO_FILE}: sha256 ${buildInfoSha256}, this app pins ${pin.buildInfo}`;
  }
  for (const [name, relative] of bundleFiles(target, withVulkan)) {
    let actual: string;
    try {
      actual = await signatureFreeSha256(join(dir, relative));
    } catch (cause) {
      return `${relative}: ${String(cause)}`;
    }
    const expected = pin.outputs[name];
    if (actual !== expected) return `${relative}: ${actual}, this app pins ${expected ?? 'nothing'}`;
  }
  return undefined;
}
