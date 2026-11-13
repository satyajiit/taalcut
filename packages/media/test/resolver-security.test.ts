// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Review 4, §3: in a packaged app TAALCUT_FFMPEG_DIR beat the signed
 * sidecar, a self-consistent directory with its own BUILDINFO.json was
 * accepted as verified, and the binaries ran before BUILDINFO.json was
 * parsed or checksummed. The fake binaries log every call, so "never ran" is
 * checked, not assumed.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBinaryResolver, fakeBuild, invocations, pinnedSidecar } from './helpers/fake-build';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'taalcut-resolver-security-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

afterEach(() => vi.unstubAllEnvs());

describe('the binary resolver in a packaged app', { timeout: 120_000 }, () => {
  it('ignores TAALCUT_FFMPEG_DIR: the pinned sidecar runs, the directory it names never does', async () => {
    const envDir = await fakeBuild(join(root, 'env')); // self-consistent, with its own BUILDINFO.json
    const packaged = await pinnedSidecar(join(root, 'sidecar'));

    const given = await createBinaryResolver({
      ...packaged,
      env: { TAALCUT_FFMPEG_DIR: envDir },
      requireLgpl: true,
    }).resolve();
    // The desktop passes env: {}; without it the process environment is read, and still ignored.
    vi.stubEnv('TAALCUT_FFMPEG_DIR', envDir);
    const { env: _, ...withoutEnv } = packaged;
    const inherited = await createBinaryResolver({ ...withoutEnv, requireLgpl: true }).resolve();

    for (const result of [given, inherited]) {
      expect(result.ok && result.value).toMatchObject({
        source: 'sidecar',
        verified: true,
        ffmpeg: join(root, 'sidecar', 'ffmpeg'),
      });
    }
    expect(await invocations(envDir)).toEqual([]);
  });

  it('refuses a sidecar replaced together with its BUILDINFO.json, before running it', async () => {
    const swapped = await fakeBuild(join(root, 'replaced')); // consistent with itself, not with the app
    const result = await createBinaryResolver({ env: {}, sidecarDir: swapped, requireLgpl: true }).resolve();
    expect(!result.ok && result.error).toMatchObject({
      code: 'media.ffmpeg_build_mismatch',
      params: { reason: 'checksum' },
    });
    expect(await invocations(swapped)).toEqual([]);
  });

  it('refuses a pinned sidecar whose binary was changed afterwards, before running it', async () => {
    const packaged = await pinnedSidecar(join(root, 'tampered'));
    const ffmpeg = join(root, 'tampered', 'ffmpeg');
    await writeFile(ffmpeg, `${await readFile(ffmpeg, 'utf8')}\n# changed\n`);
    const result = await createBinaryResolver(packaged).resolve();
    expect(!result.ok && result.error).toMatchObject({ params: { reason: 'checksum' } });
    expect(!result.ok && result.error.detail).toMatch(/^ffmpeg: \w+, this app pins \w+$/);
    expect(await invocations(join(root, 'tampered'))).toEqual([]);
  });
});

describe('BUILDINFO.json comes before any spawn', { timeout: 120_000 }, () => {
  it('a directory whose BUILDINFO.json is not JSON is refused and its binaries never run', async () => {
    const envDir = await fakeBuild(join(root, 'garbage-env'), { buildInfo: 'not-json' });
    const development = await createBinaryResolver({
      env: { TAALCUT_FFMPEG_DIR: envDir },
      development: true,
    }).resolve();
    const packaged = await pinnedSidecar(join(root, 'garbage-sidecar'), { buildInfo: 'not-json' });
    const sidecar = await createBinaryResolver(packaged).resolve();

    for (const result of [development, sidecar]) {
      expect(!result.ok && result.error).toMatchObject({
        code: 'media.ffmpeg_build_mismatch',
        params: { reason: 'buildinfo_invalid' },
      });
    }
    expect(await invocations(envDir)).toEqual([]);
    expect(await invocations(join(root, 'garbage-sidecar'))).toEqual([]);
  });

  it('a verified build runs each binary only for -version and -L', async () => {
    const packaged = await pinnedSidecar(join(root, 'calls'));
    expect((await createBinaryResolver(packaged).resolve()).ok).toBe(true);
    expect((await invocations(join(root, 'calls'))).sort()).toEqual([
      'ffmpeg -hide_banner -L',
      'ffmpeg -hide_banner -version',
      'ffprobe -hide_banner -L',
      'ffprobe -hide_banner -version',
    ]);
  });
});
