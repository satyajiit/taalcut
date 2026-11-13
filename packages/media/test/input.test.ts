// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Input confinement without FFmpeg: demuxer allowlist on every command, canonical paths. */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileFingerprint, requireFile, USER_MEDIA_DEMUXERS } from '@taalcut/media';
import { frameArgs } from '../src/frames/frame-args';
import { graphInputArgs } from '../src/normalise/graph';
import { probeArgs } from '../src/probe/probe';
import { videoPlan } from './helpers/video-plan';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'taalcut-input-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('demuxer allowlist', () => {
  it('leaves out every demuxer that opens other files', () => {
    for (const reader of ['hls', 'concat', 'dash', 'imf', 'image2', 'image2pipe']) {
      expect(USER_MEDIA_DEMUXERS).not.toContain(reader);
    }
  });

  it('is on the probe and on both frame routes, before the input', () => {
    const at = { value: 0, rate: 1 };
    const gpu = { backend: 'videotoolbox', surfaceFormat: 'nv12', rotation: 0 } as const;
    for (const args of [probeArgs('/a.mov'), frameArgs('/a.mov', at), frameArgs('/a.mov', at, {}, gpu)]) {
      const whitelist = args.indexOf('-format_whitelist');
      expect(whitelist).toBeGreaterThan(-1);
      expect(args[whitelist + 1]).toBe(USER_MEDIA_DEMUXERS.join(','));
      expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('file');
      expect(whitelist).toBeLessThan(args.indexOf('-i'));
    }
  });

  it('forces the pipe demuxer for a still, and leaves a movie alone', () => {
    const jpeg = probeArgs('/photos/a.jpg');
    expect(jpeg[jpeg.indexOf('-f') + 1]).toBe('jpeg_pipe');
    const png = probeArgs('/photos/a.PNG');
    expect(png[png.indexOf('-f') + 1]).toBe('png_pipe');
    expect(probeArgs('/a.mov').includes('-f')).toBe(false);
  });

  it('confines every normalisation graph input, and forces a still off image2', () => {
    const graph = { preInput: ['-noautorotate'], tail: [] };
    for (const path of ['/photos/IMG_1.JPG', '/clips/a.mov', '/photos/b.heic']) {
      const args = graphInputArgs(path, videoPlan(), graph, true);
      const input = args.indexOf('-i');
      expect(args[args.indexOf('-format_whitelist') + 1]).toBe(USER_MEDIA_DEMUXERS.join(','));
      expect(args.indexOf('-format_whitelist')).toBeLessThan(input);
      expect(args[input + 1]).toBe(`file:${path}`);
    }
    const jpeg = graphInputArgs('/photos/IMG_1.JPG', videoPlan(), graph, true);
    expect(jpeg[jpeg.indexOf('-i') - 1]).toBe('jpeg_pipe');
    expect(graphInputArgs('/photos/b.heic', videoPlan(), graph, true).includes('-f')).toBe(false);
  });
});

describe('requireFile', () => {
  it('returns the real path of a symlink, and of a path with ..', async () => {
    await mkdir(join(dir, 'secret'));
    await mkdir(join(dir, 'granted'));
    const target = join(dir, 'secret', 'private.mp4');
    await writeFile(target, 'x');
    const link = join(dir, 'granted', 'link.mp4');
    await symlink(target, link);
    const real = await realpath(target);
    expect(await requireFile(link)).toEqual({ ok: true, value: real });
    expect(await requireFile(join(dir, 'granted', '..', 'secret', 'private.mp4'))).toEqual({
      ok: true,
      value: real,
    });
    expect(fileFingerprint(link)).toBe(fileFingerprint(target));
    expect(fileFingerprint(link).startsWith(`${real}|1|`)).toBe(true);
  });

  it('refuses a dangling link and a directory', async () => {
    const dangling = join(dir, 'dangling.mp4');
    await symlink(join(dir, 'nowhere.mp4'), dangling);
    expect(await requireFile(dangling)).toMatchObject({ ok: false, error: { code: 'media.file_not_found' } });
    expect(await requireFile(dir)).toMatchObject({ ok: false, error: { code: 'media.file_not_found' } });
  });
});
