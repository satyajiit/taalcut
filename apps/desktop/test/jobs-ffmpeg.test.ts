// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the jobs process looks for FFmpeg. A checkout must use the
 * development build (tools/ffmpeg/dist, dist/linux-x64 on Linux), not
 * Electron's own Resources/bin, which never has sidecars; a packaged app only
 * its sidecars (Resources/bin on a Mac, Resources/ffmpeg on Linux: the
 * platform's build target).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ffmpegBuildTarget } from '@taalcut/media';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaBinaries } from '../src/utility/roots/jobs-root';
import { testConfig } from './helpers/roots';

afterEach(() => vi.unstubAllEnvs());

// With tools/ffmpeg/dist built, resolve() hashes ~60 MB of binaries and runs ffmpeg and ffprobe
// for their versions; a loaded machine can take well over the 5 s default for that.
describe("the jobs process's FFmpeg", { timeout: 30_000 }, () => {
  it('comes from the development build in a checkout, never from Resources/bin', async () => {
    vi.stubEnv('TAALCUT_FFMPEG_DIR', '');
    const config = testConfig('jobs');
    mkdirSync(join(config.resourcesPath, 'bin'), { recursive: true });
    const found = await mediaBinaries(config).resolve();
    // With tools/ffmpeg/dist built it resolves there; without, the error names the development build.
    if (found.ok) expect(found.value).toMatchObject({ source: 'dev-build' });
    else expect(found.error.detail).toMatch(/tools\/ffmpeg\/build(-linux)?\.sh/);
    if (!found.ok) expect(found.error.detail).not.toContain(config.resourcesPath);
  });

  it('comes only from the sidecars when packaged', async () => {
    vi.stubEnv('TAALCUT_FFMPEG_DIR', '');
    const config = { ...testConfig('jobs'), packaged: true };
    const found = await mediaBinaries(config).resolve();
    expect(!found.ok && found.error).toMatchObject({ code: 'media.ffmpeg_not_found' });
    const folder = ffmpegBuildTarget()?.resourcesFolder ?? 'bin';
    expect(!found.ok && found.error.detail).toContain(join(config.resourcesPath, folder));
  });
});
