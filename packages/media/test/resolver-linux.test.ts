// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The resolver on the linux-x64 target's layout (bin/ffmpeg, bin/ffprobe, lib/<soname>, no Vulkan driver), with
 * fake binaries, on any host: the pinned sidecar resolves, a changed library is refused, and an override without
 * BUILDINFO.json (a system FFmpeg) is a flat folder.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bundleFiles, createBinaryResolver, FFMPEG_BUILD_TARGETS, pinBuild } from '@taalcut/media';
import { LICENCE_TEXTS, sha } from './helpers/fake-build';

const LINUX = FFMPEG_BUILD_TARGETS['linux-x64'];
const roots: string[] = [];
afterAll(() => Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true }))));

const script = (name: string) =>
  [
    '#!/bin/sh',
    'case "$*" in',
    `  *-version*) echo "${name} version ${LINUX.version} Copyright (c) 2000-2026 the FFmpeg developers"; echo "configuration: --enable-version3 --enable-ffnvcodec"; ;;`,
    `  *-L*) cat <<'EOF'\n${LICENCE_TEXTS['lgpl3']?.replace('%s', name)}\nEOF\n  ;;`,
    '  *) exit 1 ;;',
    'esac',
    '',
  ].join('\n');

/** A linux-x64 build folder of fakes and its BUILDINFO.json, as build-linux.sh lays it out. */
async function linuxBuild(withInfo = true): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'taalcut-linux-build-'));
  roots.push(dir);
  await mkdir(join(dir, 'bin'));
  await mkdir(join(dir, 'lib'));
  const outputs = [];
  for (const [name, path] of bundleFiles(LINUX, false)) {
    const body = name === 'ffmpeg' || name === 'ffprobe' ? script(name) : `not really ${name}`;
    await writeFile(join(dir, path), body);
    await chmod(join(dir, path), 0o755);
    outputs.push({ bytes: body.length, name, path, sha256: sha(body) });
  }
  if (withInfo) {
    const info = {
      configure: '--enable-version3 --enable-ffnvcodec',
      ffmpeg_version: LINUX.version,
      gpl: false,
      license: 'LGPL-3.0-or-later',
      nonfree: false,
      outputs,
      target: 'linux-x64',
    };
    await writeFile(join(dir, 'BUILDINFO.json'), JSON.stringify(info, null, 2));
  }
  return dir;
}

const resolver = (options: Parameters<typeof createBinaryResolver>[0]) =>
  createBinaryResolver({ timeoutMs: 60_000, log: () => {}, target: LINUX, ...options });

describe.skipIf(process.platform === 'win32')('the linux-x64 layout', () => {
  it('resolves a pinned sidecar from bin/, checks the libraries, and has no Vulkan ICD', async () => {
    const dir = await linuxBuild();
    const pinned = await pinBuild(dir, false, LINUX);
    expect(Object.keys(pinned.outputs)).toEqual(bundleFiles(LINUX, false).map(([name]) => name));
    const result = await resolver({ env: {}, sidecarDir: dir, pinned, requireLgpl: true }).resolve();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ffmpeg).toBe(join(dir, 'bin', 'ffmpeg'));
    expect(result.value.ffprobe).toBe(join(dir, 'bin', 'ffprobe'));
    expect(result.value.source).toBe('sidecar');
    expect(result.value.vulkanIcd).toBeUndefined();
  });

  it('refuses a sidecar whose library is not the pinned one', async () => {
    const dir = await linuxBuild();
    const pinned = await pinBuild(dir, false, LINUX);
    await writeFile(join(dir, 'lib', 'libavcodec.so.63'), 'swapped');
    const result = await resolver({ env: {}, sidecarDir: dir, pinned }).resolve();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.detail).toContain('libavcodec.so.63');
  });

  it('takes a development override without BUILDINFO.json as a flat folder of binaries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-linux-flat-'));
    roots.push(dir);
    for (const name of ['ffmpeg', 'ffprobe']) {
      await writeFile(join(dir, name), script(name));
      await chmod(join(dir, name), 0o755);
    }
    const result = await resolver({ env: { TAALCUT_FFMPEG_DIR: dir }, development: true }).resolve();
    expect(result.ok && result.value.ffmpeg).toBe(join(dir, 'ffmpeg'));
  });

  it('uses the target layout for a development override that has BUILDINFO.json', async () => {
    const dir = await linuxBuild();
    const result = await resolver({ env: { TAALCUT_FFMPEG_DIR: dir }, development: true }).resolve();
    expect(result.ok && result.value.ffmpeg).toBe(join(dir, 'bin', 'ffmpeg'));
  });
});
