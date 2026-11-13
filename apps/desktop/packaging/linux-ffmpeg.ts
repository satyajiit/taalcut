// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * afterPack on Linux: the packed resources/ffmpeg must be the build media pins for linux-x64, LGPL, found by the
 * same resolver the packaged app runs (utility/roots/media-jobs.ts: `sidecarDir`, `requireLgpl: true`, no
 * environment). So no package ships without FFmpeg, with another build, or with a GPL one. On a linux-x64 host the
 * resolver also runs both binaries (`-version`, `-L`); elsewhere it can't, and the files are checked against the
 * pin without running them.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AfterPackContext } from 'electron-builder';
import { bundleFiles, createBinaryResolver, FFMPEG_BUILD_TARGETS, type ResolvedFfmpeg } from '@taalcut/media';

const FIX = 'Run tools/ffmpeg/build-linux.sh, then package again.';

export function packedFfmpegDir(appOutDir: string): string {
  return join(appOutDir, 'resources', FFMPEG_BUILD_TARGETS['linux-x64'].resourcesFolder);
}

/** Problems with the packed build that need nothing run: missing files, a BUILDINFO.json that isn't the pinned one. */
export function packedFfmpegProblems(dir: string): string[] {
  const target = FFMPEG_BUILD_TARGETS['linux-x64'];
  const wanted = [...bundleFiles(target, false).map(([, path]) => path), 'BUILDINFO.json', 'LICENSE.txt'];
  const missing = wanted.filter((path) => !existsSync(join(dir, path)));
  if (missing.length > 0) return missing.map((path) => `${join(dir, path)} is missing`);
  const info = createHash('sha256')
    .update(readFileSync(join(dir, 'BUILDINFO.json')))
    .digest('hex');
  return info === target.pinned.buildInfo
    ? []
    : [`${join(dir, 'BUILDINFO.json')} is ${info}, not the pinned ${target.pinned.buildInfo}`];
}

/** The resolver the app runs, on the packed folder. */
export async function resolvePackedFfmpeg(dir: string): Promise<ResolvedFfmpeg> {
  const resolved = await createBinaryResolver({
    sidecarDir: dir,
    requireLgpl: true,
    env: {},
    target: FFMPEG_BUILD_TARGETS['linux-x64'],
  }).resolve();
  if (!resolved.ok) {
    throw new Error(
      `The packed FFmpeg in ${dir} is refused: ${resolved.error.code} ${resolved.error.detail ?? ''}`,
    );
  }
  return resolved.value;
}

export async function checkPackedFfmpeg(
  context: Pick<AfterPackContext, 'electronPlatformName' | 'appOutDir'>,
  options: { readonly canRun?: boolean; readonly log?: (message: string) => void } = {},
): Promise<void> {
  if (context.electronPlatformName !== 'linux') return;
  const { canRun = process.platform === 'linux' && process.arch === 'x64', log = console.warn } = options;
  const dir = packedFfmpegDir(context.appOutDir);
  const problems = packedFfmpegProblems(dir);
  if (problems.length > 0) throw new Error(`${problems.join('\n')}\n${FIX}`);
  if (!canRun) {
    log(`packed FFmpeg matches the linux-x64 pin (not run: this host can't run it)`);
    return;
  }
  const resolved = await resolvePackedFfmpeg(dir);
  log(
    `packed FFmpeg ${resolved.ffmpegInfo.version} (${resolved.ffmpegInfo.licence}) verified against the pin`,
  );
}
