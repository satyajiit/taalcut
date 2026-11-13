// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fake ffmpeg/ffprobe for the resolver tests: shell scripts that print
 * FFmpeg's real `-version` and `-L` texts and append each call to
 * `<dir>/invocations`, next to a BUILDINFO.json written the way
 * tools/ffmpeg/build.sh writes it.
 */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BUNDLED_FFMPEG_VERSION,
  createBinaryResolver as createResolver,
  FFMPEG_BUILD_TARGETS,
  pinBuild,
  type BinaryResolverOptions,
  type PinnedFfmpegBuild,
} from '@taalcut/media';

/** The fakes are laid out as the macOS build is (binaries at the top, MoltenVK in lib/), on any host. */
export const MAC_TARGET = FFMPEG_BUILD_TARGETS['darwin-arm64'];

/**
 * The fake binaries answer at once, but a machine running every package's
 * tests together can stall a spawn past the resolver's 10 s default. Nothing
 * here tests that limit.
 */
export const createBinaryResolver = (options: BinaryResolverOptions) =>
  createResolver({ timeoutMs: 60_000, log: () => {}, target: MAC_TARGET, ...options });

/** The texts FFmpeg's show_license() prints, by configure flags. */
export const LICENCE_TEXTS: Record<string, string> = {
  lgpl21:
    '%s is free software; you can redistribute it and/or\nmodify it under the terms of the GNU Lesser General Public\nLicense as published by the Free Software Foundation; either\nversion 2.1 of the License, or (at your option) any later version.',
  lgpl3:
    '%s is free software; you can redistribute it and/or modify\nit under the terms of the GNU Lesser General Public License as published by\nthe Free Software Foundation; either version 3 of the License, or\n(at your option) any later version.',
  gpl2: '%s is free software; you can redistribute it and/or modify\nit under the terms of the GNU General Public License as published by\nthe Free Software Foundation; either version 2 of the License, or\n(at your option) any later version.',
  gpl3: '%s is free software; you can redistribute it and/or modify\nit under the terms of the GNU General Public License as published by\nthe Free Software Foundation; either version 3 of the License, or\n(at your option) any later version.',
  nonfree: 'This version of %s has nonfree parts compiled in.\nTherefore it is not legally redistributable.',
};

export const CONFIGURE =
  "--arch=arm64 --disable-gpl --enable-libplacebo --extra-cflags='-mmacosx-version-min=14.0 -O2'";

export interface FakeBuild {
  readonly licence?: keyof typeof LICENCE_TEXTS;
  /** What the binaries print in `configuration:`. */
  readonly configure?: string;
  /** What the binaries say their version is. */
  readonly version?: string;
  /** BUILDINFO.json fields to change, false for none, or text to write instead. */
  readonly buildInfo?: false | string | Record<string, unknown>;
  readonly moltenVk?: boolean;
}

export const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

/** Writes fake ffmpeg and ffprobe into `dir`, and a BUILDINFO.json that matches them. */
export async function fakeBuild(dir: string, build: FakeBuild = {}): Promise<string> {
  const { licence = 'lgpl21', configure = CONFIGURE, version = BUNDLED_FFMPEG_VERSION } = build;
  await mkdir(dir, { recursive: true });
  const outputs: { name: string; sha256: string }[] = [];
  for (const name of ['ffmpeg', 'ffprobe']) {
    const text = LICENCE_TEXTS[licence]?.replace('%s', name) ?? '';
    const body = [
      '#!/bin/sh',
      `echo "${name} $*" >> "${join(dir, 'invocations')}"`,
      'case "$*" in',
      `  *-version*) echo "${name} version ${version} Copyright (c) 2000-2026 the FFmpeg developers"; cat <<'EOF'\nconfiguration: ${configure}\nEOF\n  ;;`,
      `  *-L*) cat <<'EOF'\n${text}\nEOF\n  ;;`,
      '  *) exit 1 ;;',
      'esac',
      '',
    ].join('\n');
    await writeFile(join(dir, name), body);
    await chmod(join(dir, name), 0o755);
    outputs.push({ name, sha256: sha(body) });
  }
  if (build.moltenVk) {
    await mkdir(join(dir, 'lib'), { recursive: true });
    const icd = '{"ICD":{"library_path":"./libMoltenVK.dylib"}}';
    await writeFile(join(dir, 'lib', 'MoltenVK_icd.json'), icd);
    await writeFile(join(dir, 'lib', 'libMoltenVK.dylib'), 'not really a dylib');
    outputs.push(
      { name: 'MoltenVK_icd.json', sha256: sha(icd) },
      { name: 'libMoltenVK.dylib', sha256: sha('not really a dylib') },
    );
  }
  if (typeof build.buildInfo === 'string') {
    await writeFile(join(dir, 'BUILDINFO.json'), build.buildInfo);
  } else if (build.buildInfo !== false) {
    const info = {
      configure: CONFIGURE,
      ffmpeg_version: BUNDLED_FFMPEG_VERSION,
      gpl: false,
      license: 'LGPL-2.1-or-later',
      nonfree: false,
      outputs,
      ...build.buildInfo,
    };
    await writeFile(join(dir, 'BUILDINFO.json'), JSON.stringify(info, null, 2));
  }
  return dir;
}

/** Each call the fake binaries in `dir` received, as `<name> <args>`. */
export async function invocations(dir: string): Promise<string[]> {
  const log = await readFile(join(dir, 'invocations'), 'utf8').catch(() => '');
  return log.split('\n').filter(Boolean);
}

/**
 * Packaged-app options for a sidecar built with `fakeBuild`, pinned to what
 * was built (as the app pins tools/ffmpeg/dist). No pin when there is no
 * BUILDINFO.json to hash: the default pin then refuses it.
 */
export async function pinnedSidecar(
  dir: string,
  build: FakeBuild = {},
): Promise<Pick<BinaryResolverOptions, 'sidecarDir' | 'pinned' | 'env'>> {
  await fakeBuild(dir, build);
  const pinned: PinnedFfmpegBuild | undefined = await pinBuild(dir, build.moltenVk ?? false).catch(
    () => undefined,
  );
  return { sidecarDir: dir, env: {}, ...(pinned ? { pinned } : {}) };
}
