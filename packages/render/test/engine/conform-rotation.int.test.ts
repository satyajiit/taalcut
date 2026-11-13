// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Conform keeps a phone clip upright exactly once (SPEC section 4, media SPEC "Rotation"): a coded
 * landscape frame with a 90° display matrix (and a mirrored one, as some front cameras write) must
 * conform to a segment that shows what a player shows for the original, with no display matrix left
 * on the segment for a player to apply a second time. Both routes: VideoToolbox and the software
 * fallback.
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, newId } from '@taalcut/core';
import { HardwareFailures, probeMedia, type MediaContext } from '@taalcut/media';
import { conformVisual } from '../../src/engine/conform';
import { ffmpeg, findTestMedia, mediaContext, patchColour, probeJson, tempDir } from '../support/media';
import { plannedVisual } from '../support/planned';
import { FIXTURE_H264, hostVideo, type HostVideo } from '../support/host-video';

const media = await findTestMedia('conform-rotation');
const rate = FrameRate.of(30);

/** Quadrant centres of the 108×192 upright picture. */
const PATCHES = [
  { x: 23, y: 44 },
  { x: 77, y: 44 },
  { x: 23, y: 140 },
  { x: 77, y: 140 },
];

const close = (a: readonly number[], b: readonly number[]) =>
  a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= 24);

describe.skipIf(!media.binaries)('conform rotation', { timeout: 240_000 }, () => {
  let host: HostVideo;
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let coded: string;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    host = await hostVideo(ctx);
    work = await tempDir('rotation');
    // Coded landscape 192×108, four distinct quadrants, so any wrong turn or flip shows.
    coded = join(work.dir, 'coded.mp4');
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'nullsrc=s=192x108:r=30:d=1',
      '-vf',
      "geq=r='if(lt(X,W/2),230,20)':g='if(lt(Y,H/2),230,20)':b='if(lt(X,W/2),20,200)',format=yuv420p",
      '-c:v',
      FIXTURE_H264,
      '-b:v',
      '8M',
      coded,
    ]);
  });
  afterAll(async () => work?.dispose());

  /** The original with a display matrix written on remux, the way a phone writes it. */
  const withMatrix = async (name: string, flags: readonly string[]) => {
    const out = join(work.dir, `${name}.mp4`);
    await ffmpeg(ctx, [...flags, '-i', coded, '-c', 'copy', out]);
    return out;
  };

  const shown = (path: string) => Promise.all(PATCHES.map((patch) => patchColour(ctx, path, 0, patch)));

  const conform = async (path: string, route: 'hardware' | 'software') => {
    const info = await stat(path);
    let failures: HardwareFailures | undefined;
    if (route === 'software') {
      const probe = await probeMedia(path, ctx);
      if (!probe.ok || !probe.value.video) throw new Error('probe failed');
      failures = new HardwareFailures();
      failures.remember(probe.value.video, { code: 'hardware_failed', detail: 'test forces software' });
    }
    const conformed = await conformVisual(
      plannedVisual(6),
      { path, size: info.size, mtimeMs: info.mtimeMs },
      {
        dir: join(work.dir, `conform-${route}-${newId()}`),
        rate,
        width: 108,
        height: 192,
        ctx: failures ? { ...ctx, hardwareFailures: failures } : ctx,
      },
    );
    if (!conformed.ok) throw new Error(`${conformed.error.code}: ${conformed.error.detail ?? ''}`);
    // The machine's row (VideoToolbox, NVDEC) on the hardware route; a machine with none decodes in software.
    expect(conformed.value.decode).toBe(route === 'hardware' ? (host.decode ?? 'software') : 'software');
    return conformed.value.file;
  };

  const matrixOf = async (path: string) => {
    const probe = (await probeJson(ctx, path, 'stream_side_data=side_data_type')) as {
      streams?: { side_data_list?: { side_data_type: string }[] }[];
    };
    return (probe.streams?.[0]?.side_data_list ?? []).some((entry) =>
      /display matrix/i.test(entry.side_data_type),
    );
  };

  it.each([
    ['rotated', ['-display_rotation', '90']],
    ['rotated and mirrored', ['-display_rotation', '90', '-display_hflip']],
  ] as const)('a %s phone clip is upright once on both routes', async (name, flags) => {
    const original = await withMatrix(name.replace(/ /g, '-'), flags);
    expect(await matrixOf(original)).toBe(true);
    // What a player shows for the original: FFmpeg's own autorotate honours the whole matrix.
    const expected = await shown(original);
    for (const route of ['hardware', 'software'] as const) {
      const segment = await conform(original, route);
      expect(await matrixOf(segment), `${route} segment keeps no display matrix`).toBe(false);
      const colours = await shown(segment);
      colours.forEach((colour, index) =>
        expect(
          close(colour, expected[index]!),
          `${route} quadrant ${index}: ${colour} vs ${expected[index]}`,
        ).toBe(true),
      );
    }
  });
});
