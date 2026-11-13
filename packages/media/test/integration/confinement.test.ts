// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Reads stay on the file that was asked for: a playlist can't pull in a file
 * outside its folder, and a symlink is reported as its real target. Uses real
 * ffprobe and ffmpeg; skips when no FFmpeg is installed.
 */
import { copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractFrame, probeMedia, runFfmpeg, type MediaContext } from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';

const found = await findTestBinaries('media confinement integration');

describe.skipIf(!found.binaries)(`input confinement${found.binaries ? '' : ' (no FFmpeg found)'}`, () => {
  let ctx: MediaContext;
  let root: string;
  let secret: string;
  let granted: string;

  beforeAll(async () => {
    ctx = { binaries: found.binaries! };
    root = await mkdtemp(join(tmpdir(), 'taalcut-confine-'));
    granted = join(root, 'granted');
    await mkdir(granted);
    await mkdir(join(root, 'secret'));
    secret = join(root, 'secret', 'private.mp4');
    // mpeg4 is FFmpeg's own encoder, so this works on GPL and LGPL builds alike.
    const made = await runFfmpeg(ctx, [
      ...['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=32x8:d=0.2', '-frames:v', '3', '-c:v', 'mpeg4'],
      ...['-metadata', 'title=SECRET_TITLE_XYZ', secret],
    ]);
    if (!made.ok) throw new Error(`fixture: ${made.error.detail ?? made.error.code}`);
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  const playlist = (target: string) =>
    [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:1',
      '#EXTINF:1.0,',
      target,
      '#EXT-X-ENDLIST',
      '',
    ].join('\n');

  it('refuses an HLS playlist whose segment points outside its folder', async () => {
    const path = join(granted, 'clip.m3u8');
    await writeFile(path, playlist('../secret/private.mp4'));
    const probed = await probeMedia(path, ctx);
    expect(probed.ok).toBe(false);
    expect(!probed.ok && probed.error.code).toBe('media.probe_failed');
    expect(!probed.ok && probed.error.detail).toMatch(/not on whitelist/);
    expect(JSON.stringify(probed)).not.toContain('SECRET_TITLE_XYZ');

    const frame = await extractFrame(path, { value: 0, rate: 1 }, ctx);
    expect(!frame.ok && frame.error.code).toBe('media.decode_failed');
    expect(!frame.ok && frame.error.detail).toMatch(/not on whitelist/);
  });

  it('refuses a playlist even inside its own folder, and one disguised as .mp4', async () => {
    // A playlist can name any file, so playlists are refused outright rather than checked segment by segment.
    await copyFile(secret, join(granted, 'other.mp4'));
    const inside = join(granted, 'local.m3u8');
    await writeFile(inside, playlist('other.mp4'));
    expect((await probeMedia(inside, ctx)).ok).toBe(false);

    const disguised = join(granted, 'holiday.mp4');
    await writeFile(disguised, playlist('../secret/private.mp4'));
    const probed = await probeMedia(disguised, ctx);
    expect(!probed.ok && probed.error.code).toBe('media.probe_failed');
    expect(JSON.stringify(probed)).not.toContain('SECRET_TITLE_XYZ');
  });

  it('refuses an ffconcat script', async () => {
    const path = join(granted, 'list.ffconcat');
    await writeFile(path, `ffconcat version 1.0\nfile '${secret}'\n`);
    const probed = await probeMedia(path, ctx);
    expect(!probed.ok && probed.error.code).toBe('media.probe_failed');
  });

  it('reports a symlink as the real file it points to', async () => {
    const link = join(granted, 'link.mp4');
    await symlink(secret, link);
    const probed = await probeMedia(link, ctx);
    expect(probed.ok && probed.value.path).toBe(await realpath(secret));
  });

  it('still reads ordinary containers and stills', async () => {
    const still = join(granted, 'photo.png');
    const made = await runFfmpeg(ctx, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=16x16',
      '-frames:v',
      '1',
      still,
    ]);
    expect(made.ok).toBe(true);
    const probedStill = await probeMedia(still, ctx);
    expect(probedStill.ok && probedStill.value.video).toMatchObject({ width: 16, height: 16 });
    const probedMp4 = await probeMedia(secret, ctx);
    expect(probedMp4.ok && probedMp4.value.video).toMatchObject({ width: 32, height: 8 });
  });
});
