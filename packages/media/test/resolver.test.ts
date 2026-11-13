// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Binary resolution and the bundled-build check, using fake ffmpeg/ffprobe
 * scripts (helpers/fake-build.ts). Packaged-app cases pin the fake sidecar
 * the way the app pins tools/ffmpeg/dist; resolver-security.test.ts has the
 * cases where the pin or the environment is the attack.
 */
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUNDLED_FFMPEG_VERSION, classifyLicence, type FfmpegLicence } from '@taalcut/media';
import {
  CONFIGURE,
  createBinaryResolver,
  fakeBuild,
  invocations,
  LICENCE_TEXTS,
  pinnedSidecar,
} from './helpers/fake-build';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'taalcut-resolver-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('classifyLicence', () => {
  it.each<[string, FfmpegLicence]>([
    ['lgpl21', 'LGPL-2.1-or-later'],
    ['lgpl3', 'LGPL-3.0-or-later'],
    ['gpl2', 'GPL-2.0-or-later'],
    ['gpl3', 'GPL-3.0-or-later'],
    ['nonfree', 'nonfree'],
  ])('reads the %s text', (key, licence) => {
    expect(classifyLicence(LICENCE_TEXTS[key] ?? '')).toBe(licence);
  });

  it('calls anything else unknown', () => {
    expect(classifyLicence('Hyper Commercial Licence')).toBe('unknown');
  });
});

describe('createBinaryResolver', { timeout: 120_000 }, () => {
  it('in development, uses tools/ffmpeg/dist checked against BUILDINFO.json, with its MoltenVK', async () => {
    const dev = await fakeBuild(join(root, 'dev'), { moltenVk: true });
    const result = await createBinaryResolver({ env: {}, development: true, devBuildDir: dev }).resolve();
    expect(result.ok && result.value).toMatchObject({
      ffmpeg: join(dev, 'ffmpeg'),
      source: 'dev-build',
      verified: true,
      vulkanIcd: join(dev, 'lib', 'MoltenVK_icd.json'),
      build: { version: BUNDLED_FFMPEG_VERSION, licence: 'LGPL-2.1-or-later' },
      ffmpegInfo: { version: BUNDLED_FFMPEG_VERSION, licence: 'LGPL-2.1-or-later' },
    });
  });

  it('uses the injected sidecar outside development, checked against the build the app pins', async () => {
    const packaged = await pinnedSidecar(join(root, 'sidecar'), { moltenVk: true });
    const result = await createBinaryResolver(packaged).resolve();
    expect(result.ok && result.value).toMatchObject({
      source: 'sidecar',
      verified: true,
      vulkanIcd: join(root, 'sidecar', 'lib', 'MoltenVK_icd.json'),
    });
    // The real pin (tools/ffmpeg/dist) is not this fake build.
    const unpinned = await createBinaryResolver({ env: {}, sidecarDir: join(root, 'sidecar') }).resolve();
    expect(!unpinned.ok && unpinned.error).toMatchObject({
      code: 'media.ffmpeg_build_mismatch',
      params: { reason: 'checksum' },
    });
    expect(!unpinned.ok && unpinned.error.detail).toMatch(/BUILDINFO\.json: sha256 \w+, this app pins/);
  });

  it.each([
    ['a GPL licence in BUILDINFO', { buildInfo: { license: 'GPL-3.0-or-later' } }, 'licence'],
    ['gpl: true in BUILDINFO', { buildInfo: { gpl: true } }, 'licence'],
    [
      '--enable-nonfree in BUILDINFO',
      { buildInfo: { configure: `${CONFIGURE} --enable-nonfree` } },
      'licence',
    ],
    ['a binary whose -L says GPL', { licence: 'gpl3' }, 'licence'],
    ['another FFmpeg release in BUILDINFO', { buildInfo: { ffmpeg_version: '9.0.1' } }, 'version'],
    ['a binary that reports another version', { version: '9.0.1' }, 'version'],
    ['a binary configured differently', { configure: `${CONFIGURE} --enable-libx264` }, 'configuration'],
    ['an unreadable BUILDINFO', { buildInfo: { outputs: 'none' } }, 'buildinfo_invalid'],
    ['no BUILDINFO', { buildInfo: false }, 'no_buildinfo'],
  ] as const)('refuses a bundled build with %s', async (name, build, reason) => {
    // Pinned as shipped: what is refused is what the build declares or reports.
    const packaged = await pinnedSidecar(join(root, `refuse-${name.replace(/\W+/g, '-')}`), build);
    const result = await createBinaryResolver(packaged).resolve();
    expect(!result.ok && result.error).toMatchObject({
      code: 'media.ffmpeg_build_mismatch',
      params: { reason },
    });
  });

  it('refuses a dev build whose binary is not the one BUILDINFO hashed, without running it', async () => {
    const dev = await fakeBuild(join(root, 'swapped'));
    const original = await readFile(join(dev, 'ffprobe'), 'utf8');
    await writeFile(join(dev, 'ffprobe'), `${original}\n# swapped\n`);
    const result = await createBinaryResolver({ env: {}, development: true, devBuildDir: dev }).resolve();
    expect(!result.ok && result.error).toMatchObject({ params: { reason: 'checksum' } });
    expect(!result.ok && result.error.detail).toContain('ffprobe: sha256');
    expect(await invocations(dev)).toEqual([]);
  });

  it('in development, prefers TAALCUT_FFMPEG_DIR, and verifies it when it holds a BUILDINFO.json', async () => {
    const envDir = await fakeBuild(join(root, 'env'));
    const packaged = await pinnedSidecar(join(root, 'sidecar-env'));
    const result = await createBinaryResolver({
      ...packaged,
      env: { TAALCUT_FFMPEG_DIR: envDir },
      development: true,
    }).resolve();
    expect(result.ok && result.value).toMatchObject({
      ffprobe: join(envDir, 'ffprobe'),
      source: 'env',
      verified: true,
    });
  });

  it('takes Homebrew (no BUILDINFO) only as an explicit TAALCUT_FFMPEG_DIR in development, and says so', async () => {
    const brew = await fakeBuild(join(root, 'brew'), { licence: 'gpl3', buildInfo: false });
    const packaged = await createBinaryResolver({ env: { TAALCUT_FFMPEG_DIR: brew } }).resolve();
    expect(!packaged.ok && packaged.error).toMatchObject({ code: 'media.ffmpeg_not_found' });
    expect(await invocations(brew)).toEqual([]);
    const logs: string[] = [];
    const dev = await createBinaryResolver({
      env: { TAALCUT_FFMPEG_DIR: brew },
      development: true,
      log: (message) => logs.push(message),
    }).resolve();
    expect(dev.ok && dev.value).toMatchObject({ source: 'env', verified: false });
    expect(dev.ok && dev.value.ffmpegInfo.licence).toBe('GPL-3.0-or-later');
    expect(dev.ok && 'vulkanIcd' in dev.value).toBe(false);
    expect(logs).toEqual([
      expect.stringMatching(/unverified FFmpeg 9\.0\.2 \(GPL-3\.0-or-later\) from TAALCUT_FFMPEG_DIR=/),
    ]);
    const lgplOnly = await createBinaryResolver({
      env: { TAALCUT_FFMPEG_DIR: brew },
      development: true,
      requireLgpl: true,
    }).resolve();
    expect(!lgplOnly.ok && lgplOnly.error).toMatchObject({
      code: 'media.ffmpeg_licence_rejected',
      params: { licence: 'GPL-3.0-or-later' },
    });
  });

  it('never searches PATH: without a dev build it says how to get one', async () => {
    const onPath = await fakeBuild(join(root, 'path'), { buildInfo: false });
    const result = await createBinaryResolver({
      env: { PATH: onPath },
      development: true,
      devBuildDir: join(root, 'no-dev-build'),
    }).resolve();
    expect(!result.ok && result.error.code).toBe('media.ffmpeg_not_found');
    expect(!result.ok && result.error.detail).toMatch(/tools\/ffmpeg\/build\.sh.*TAALCUT_FFMPEG_DIR/);
    const packaged = await createBinaryResolver({ env: { PATH: onPath } }).resolve();
    expect(!packaged.ok && packaged.error.code).toBe('media.ffmpeg_not_found');
  });

  it('does not fall through when an explicit directory is wrong', async () => {
    const sidecar = await fakeBuild(join(root, 'sidecar-b'));
    const result = await createBinaryResolver({
      env: { TAALCUT_FFMPEG_DIR: join(root, 'nowhere') },
      sidecarDir: sidecar,
      development: true,
    }).resolve();
    expect(!result.ok && result.error).toMatchObject({
      code: 'media.ffmpeg_not_found',
      params: { binary: 'ffmpeg' },
    });
    expect(!result.ok && result.error.detail).toContain('TAALCUT_FFMPEG_DIR=');
  });

  it('skips files that are not executable', async () => {
    const dir = await fakeBuild(join(root, 'not-exec'));
    await chmod(join(dir, 'ffmpeg'), 0o644);
    const result = await createBinaryResolver({
      env: { TAALCUT_FFMPEG_DIR: dir },
      development: true,
    }).resolve();
    expect(!result.ok && result.error.code).toBe('media.ffmpeg_not_found');
  });

  it('caches success but retries after a failure', async () => {
    const dir = join(root, 'later');
    const packaged = await pinnedSidecar(dir);
    await rename(dir, `${dir}-away`);
    const resolver = createBinaryResolver(packaged);
    const first = await resolver.resolve();
    expect(first.ok).toBe(false);
    await rename(`${dir}-away`, dir);
    const second = await resolver.resolve();
    expect(second.ok).toBe(true);
    expect(await resolver.resolve()).toBe(second);
  });

  it('reports a binary that fails -version as media.ffmpeg_failed', async () => {
    const dir = join(root, 'broken');
    await mkdir(dir, { recursive: true });
    for (const name of ['ffmpeg', 'ffprobe']) {
      await writeFile(join(dir, name), '#!/bin/sh\necho "dyld: library not loaded" >&2\nexit 134\n');
      await chmod(join(dir, name), 0o755);
    }
    const result = await createBinaryResolver({
      env: { TAALCUT_FFMPEG_DIR: dir },
      development: true,
    }).resolve();
    expect(!result.ok && result.error).toMatchObject({
      code: 'media.ffmpeg_failed',
      params: { exitCode: 134 },
    });
    expect(!result.ok && result.error.detail).toContain('library not loaded');
  });
});
