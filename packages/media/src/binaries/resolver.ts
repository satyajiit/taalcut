// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Finds the ffmpeg and ffprobe binaries to use, in this order:
 *   1. development only: TAALCUT_FFMPEG_DIR, an explicit override;
 *   2. the bundled sidecar directory the desktop app injects (packaged app);
 *   3. development only: the platform's folder under tools/ffmpeg/dist/ (build-targets.ts), the LGPL build.
 * Nothing else: no PATH search, so a Homebrew (GPL) FFmpeg is never picked
 * up silently, and outside development no environment variable can point
 * the app at other binaries. An explicit directory that lacks the binaries
 * is an error, never a fall-through.
 *
 * A bundled build (sidecar, dev build, or an override directory holding a
 * BUILDINFO.json) is checked before anything in it runs: BUILDINFO.json must
 * parse and declare LGPL with no GPL or nonfree parts and the expected FFmpeg
 * release, and the files must hash to what is expected. A sidecar is checked
 * against the build pinned in this code (pinned-build.ts), using hashes that
 * packaging's re-signing doesn't change; a dev build or override against
 * its BUILDINFO.json's sha256s. Only then are the binaries run, and they must
 * report that version and configure line. A mismatch is
 * `media.ffmpeg_build_mismatch`. A directory without BUILDINFO.json
 * (Homebrew's bin) is accepted only as TAALCUT_FFMPEG_DIR in development, and
 * logged as unverified.
 */
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import { FfmpegBuildMismatch, FfmpegFailed, FfmpegLicenceRejected, FfmpegNotFound } from '../errors';
import { runProcess, type ProcessRunner } from '../process/runner';
import { isLgpl, readBuildInfo, type BuildInfo } from './build-info';
import {
  binaryFiles,
  ffmpegBuildTarget,
  type FfmpegBuildTarget,
  type PinnedFfmpegBuild,
} from './build-targets';
import {
  BUILDINFO_FILE,
  findChecksumMismatch,
  findVulkanIcd,
  readBundledBuild,
  type BuildMismatchReason,
  type BundledBuild,
} from './bundled-build';
import { findPinMismatch } from './pinned-build';

export const FFMPEG_DIR_ENV = 'TAALCUT_FFMPEG_DIR';

/** Where the binaries came from. */
export type BinarySource = 'env' | 'sidecar' | 'dev-build';

/** The two binary paths every media function needs. */
export interface FfmpegBinaries {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  readonly source: BinarySource;
  /**
   * The bundled Vulkan ICD (MoltenVK's `lib/MoltenVK_icd.json` on macOS), for libplacebo's Vulkan device. Absent
   * where the build ships none (Linux): libplacebo then uses the system Vulkan loader.
   */
  readonly vulkanIcd?: string;
}

/** Binaries plus what they are, for Settings → About and the licence check. */
export interface ResolvedFfmpeg extends FfmpegBinaries {
  readonly ffmpegInfo: BuildInfo;
  readonly ffprobeInfo: BuildInfo;
  /** Checked against BUILDINFO.json. False only for a development override such as Homebrew's. */
  readonly verified: boolean;
  /** What BUILDINFO.json declares, for a verified build. */
  readonly build?: BundledBuild;
}

export interface BinaryResolver {
  /** Resolves once and caches success; a failure is not cached, so a later call can find a new install. */
  resolve(): AsyncResult<ResolvedFfmpeg>;
}

export interface BinaryResolverOptions {
  /** Environment to read TAALCUT_FFMPEG_DIR from, in development only. Default: process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The bundled sidecar directory (packaged app). Injected by apps/desktop. */
  readonly sidecarDir?: string;
  /**
   * The platform's build: its version, layout and pin (build-targets.ts). Default the one for this platform and
   * architecture; where none ships, only an unverified development override can resolve.
   */
  readonly target?: FfmpegBuildTarget;
  /** What the sidecar must hash to. Default the target's pin, the build this release ships. */
  readonly pinned?: PinnedFfmpegBuild;
  /**
   * Allow TAALCUT_FFMPEG_DIR (with or without BUILDINFO.json, e.g. Homebrew)
   * and the dev build directory. Default false: a packaged app ignores the
   * environment and only ever runs its pinned sidecar.
   */
  readonly development?: boolean;
  /** Override for the target's folder under tools/ffmpeg/dist/. Default: resolved from this file's location in the repo. */
  readonly devBuildDir?: string;
  /** The FFmpeg release a bundled build must be. Default the target's version. */
  readonly expectedVersion?: string;
  /** Refuse a GPL, non-free or unidentifiable development override. Bundled builds are always LGPL. */
  readonly requireLgpl?: boolean;
  readonly runner?: ProcessRunner;
  /** Limit for each `-version` / `-L` call. Default 10 s. */
  readonly timeoutMs?: number;
  /** Where the unverified-override warning goes. Default console.warn. */
  readonly log?: (message: string) => void;
}

const DEV_DIST = fileURLToPath(new URL('../../../../tools/ffmpeg/dist/', import.meta.url));

interface Located extends FfmpegBinaries {
  readonly dir: string;
  /** Check BUILDINFO.json; false only for a development override without one. */
  readonly bundled: boolean;
}

const unsupported = (target: string): string =>
  `no FFmpeg build ships for ${target} (tools/ffmpeg builds darwin-arm64 and linux-x64)`;

export function createBinaryResolver(options: BinaryResolverOptions = {}): BinaryResolver {
  let cached: Promise<Result<ResolvedFfmpeg>> | undefined;
  return {
    resolve() {
      if (!cached) {
        cached = locate(options).then(async (found) => (found.ok ? inspect(found.value, options) : found));
        // Don't cache failures: the user may build FFmpeg or fix the setting and retry.
        void cached.then((result) => {
          if (!result.ok) cached = undefined;
        });
      }
      return cached;
    },
  };
}

async function locate(options: BinaryResolverOptions): AsyncResult<Located> {
  const target = options.target ?? ffmpegBuildTarget();
  // A packaged app never reads the variable: it would beat the signed sidecar.
  const envDir = options.development ? (options.env ?? process.env)[FFMPEG_DIR_ENV] : undefined;
  if (envDir) {
    // A build folder (with its BUILDINFO.json) is laid out as its target says; a bare one (Homebrew's bin) is flat.
    const bundled = await exists(join(envDir, BUILDINFO_FILE));
    const found = await fromDirectory(
      envDir,
      'env',
      `${FFMPEG_DIR_ENV}=${envDir}`,
      bundled ? target : undefined,
    );
    if (!found.ok) return found;
    return ok({ ...found.value, bundled });
  }
  if (!target) {
    const detail = unsupported(`${process.platform}-${process.arch}`);
    return err(
      FfmpegNotFound({ binary: 'ffmpeg' }, { detail: `${detail}; set ${FFMPEG_DIR_ENV} in development` }),
    );
  }
  if (options.sidecarDir) {
    const label = `sidecar ${options.sidecarDir}`;
    const found = await fromDirectory(options.sidecarDir, 'sidecar', label, target);
    return found.ok ? ok({ ...found.value, bundled: true }) : found;
  }
  if (!options.development) {
    return err(
      FfmpegNotFound(
        { binary: 'ffmpeg' },
        { detail: 'no sidecar directory, and this is not a development build' },
      ),
    );
  }
  const devDir = options.devBuildDir ?? join(DEV_DIST, target.devFolder);
  const dev = await fromDirectory(devDir, 'dev-build', devDir, target);
  if (dev.ok) return ok({ ...dev.value, bundled: true });
  const make = `build it with tools/ffmpeg/${target.id === 'linux-x64' ? 'build-linux.sh' : 'build.sh'}`;
  const hint = `; ${make}, or set ${FFMPEG_DIR_ENV} (e.g. to Homebrew's bin) as an explicit override`;
  const binary = String(dev.error.params?.['binary'] ?? 'ffmpeg');
  return err(FfmpegNotFound({ binary }, { detail: `${dev.error.detail ?? ''}${hint}` }));
}

async function fromDirectory(
  dir: string,
  source: BinarySource,
  label: string,
  target: Pick<FfmpegBuildTarget, 'binDir'> = { binDir: '' },
): AsyncResult<FfmpegBinaries & { dir: string }> {
  const [ffmpeg, ffprobe] = binaryFiles(target).map(([, relative]) => join(dir, relative)) as [
    string,
    string,
  ];
  for (const binary of [ffmpeg, ffprobe]) {
    if (!(await isExecutable(binary))) {
      const name = binary === ffmpeg ? 'ffmpeg' : 'ffprobe';
      return err(FfmpegNotFound({ binary: name }, { detail: `${label}: no executable ${binary}` }));
    }
  }
  return ok({ ffmpeg, ffprobe, source, dir });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

const mismatch = (binary: string, reason: BuildMismatchReason, detail: string) =>
  err(FfmpegBuildMismatch({ binary, reason }, { detail }));

async function describeBoth(binaries: FfmpegBinaries, options: BinaryResolverOptions) {
  const [ffmpeg, ffprobe] = await Promise.all([
    describeBinary(binaries.ffmpeg, options),
    describeBinary(binaries.ffprobe, options),
  ]);
  if (!ffmpeg.ok) return ffmpeg;
  if (!ffprobe.ok) return ffprobe;
  return ok({ ffmpegInfo: ffmpeg.value, ffprobeInfo: ffprobe.value });
}

async function inspect(located: Located, options: BinaryResolverOptions): AsyncResult<ResolvedFfmpeg> {
  const { dir, bundled, ...binaries } = located;
  if (!bundled) {
    // A development override such as Homebrew's bin (locate allows it only then): never silently.
    const described = await describeBoth(binaries, options);
    if (!described.ok) return described;
    const { ffmpegInfo, ffprobeInfo } = described.value;
    if (options.requireLgpl) {
      for (const info of [ffmpegInfo, ffprobeInfo]) {
        if (!isLgpl(info.licence)) {
          const detail = `${info.path} is ${info.licence} (${info.licenceLine}); an LGPL build is required`;
          const binary = info === ffmpegInfo ? 'ffmpeg' : 'ffprobe';
          return err(FfmpegLicenceRejected({ binary, licence: info.licence }, { detail }));
        }
      }
    }
    (options.log ?? console.warn)(
      `[media] using an unverified FFmpeg ${ffmpegInfo.version} (${ffmpegInfo.licence}) from ` +
        `${FFMPEG_DIR_ENV}=${dir}: a development override with no ${BUILDINFO_FILE}`,
    );
    return ok({ ...binaries, ffmpegInfo, ffprobeInfo, verified: false });
  }

  // Everything that can be checked without running anything in `dir` comes first.
  const target = options.target ?? ffmpegBuildTarget();
  if (!target) return mismatch('ffmpeg', 'version', unsupported(`${process.platform}-${process.arch}`));
  const declared = await readBundledBuild(dir, options.expectedVersion ?? target.version);
  if (!declared.ok) return mismatch('ffmpeg', declared.mismatch.reason, declared.mismatch.detail);
  const build = declared.build;
  const vulkanIcd = await findVulkanIcd(dir, target);
  const withVulkan = vulkanIcd !== undefined;
  const changed =
    located.source === 'sidecar'
      ? await findPinMismatch(dir, options.pinned ?? target.pinned, declared.fileSha256, target, withVulkan)
      : await findChecksumMismatch(dir, build, target, withVulkan);
  if (changed) return mismatch('ffmpeg', 'checksum', changed);

  const described = await describeBoth(binaries, options);
  if (!described.ok) return described;
  const { ffmpegInfo, ffprobeInfo } = described.value;
  const infos = [
    ['ffmpeg', ffmpegInfo],
    ['ffprobe', ffprobeInfo],
  ] as const;
  for (const [binary, info] of infos) {
    if (!isLgpl(info.licence)) return mismatch(binary, 'licence', `${info.path} -L says ${info.licence}`);
    if (info.version !== build.version) {
      return mismatch(
        binary,
        'version',
        `${info.path} reports ${info.version}; BUILDINFO says ${build.version}`,
      );
    }
    if (info.configuration.join(' ') !== build.configure.join(' ')) {
      return mismatch(binary, 'configuration', `${info.path} was configured differently from BUILDINFO`);
    }
  }
  return ok({
    ...binaries,
    ...(vulkanIcd ? { vulkanIcd } : {}),
    ffmpegInfo,
    ffprobeInfo,
    verified: true,
    build,
  });
}

/** Runs `-version` and `-L` on one binary. */
export async function describeBinary(
  path: string,
  options: Pick<BinaryResolverOptions, 'runner' | 'timeoutMs'> = {},
): AsyncResult<BuildInfo> {
  const run = options.runner ?? runProcess;
  const limits = { timeoutMs: options.timeoutMs ?? 10_000, maxStdoutBytes: 256 * 1024 };
  const [version, licence] = await Promise.all([
    run(path, ['-hide_banner', '-version'], limits),
    run(path, ['-hide_banner', '-L'], limits),
  ]);
  if (!version.ok) return version;
  if (!licence.ok) return licence;
  for (const output of [version.value, licence.value]) {
    if (output.exitCode !== 0) {
      const detail = `${path} -version/-L failed\n${output.stderrTail}`;
      return err(FfmpegFailed({ exitCode: output.exitCode ?? -1 }, { detail }));
    }
  }
  return ok(
    readBuildInfo(path, version.value.stdout.toString('utf8'), licence.value.stdout.toString('utf8')),
  );
}
