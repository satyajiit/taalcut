// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2 eyes: stills of any second of a file, and sheets that put them side by side in equal cells. */
import { join } from 'node:path';
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cellOf, sheetOf, stillAt } from '../../src/eyes/frames';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';

const media = await findTestMedia('eyes frames');

/** A JPEG's size from its SOF marker. */
function jpegSize(data: Buffer): { width: number; height: number } {
  for (let at = 2; at < data.length;) {
    const marker = data[at + 1]!;
    const length = data.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc3)
      return { height: data.readUInt16BE(at + 5), width: data.readUInt16BE(at + 7) };
    at += 2 + length;
  }
  throw new Error('no SOF');
}

describe.skipIf(!media.binaries)('eyes frames', { timeout: 120_000 }, () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  let video: string;
  const ctx = () => mediaContext(media.binaries!);

  beforeAll(async () => {
    work = await tempDir('eyes-frames');
    video = join(work.dir, 'portrait.mp4');
    await ffmpeg(ctx(), [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=360x640:r=30:d=3',
      '-pix_fmt',
      'yuv420p',
      ...softwareH264FixtureFlags(),
      video,
    ]);
  });
  afterAll(async () => {
    await work?.dispose();
  });

  it('cuts a still at a second, at most the long side asked', async () => {
    const still = await stillAt(ctx(), video, 1.5, 320);
    if (!still.ok) throw new Error(still.error.detail ?? still.error.code);
    expect(still.value).toMatchObject({ width: 180, height: 320 });
    expect(jpegSize(still.value.data)).toEqual({ width: 180, height: 320 });
  });

  it('lays rows of cells out as one JPEG, grey where a cell is empty', async () => {
    const a = await stillAt(ctx(), video, 0.2, 320);
    const b = await stillAt(ctx(), video, 2.5, 320);
    if (!a.ok || !b.ok) throw new Error('no stills');
    const cell = cellOf({ width: 1080, height: 1920 }, 240);
    expect(cell).toEqual({ width: 136, height: 240 });
    const sheet = await sheetOf(
      ctx(),
      work.dir,
      [
        [a.value.data, b.value.data],
        [a.value.data, null],
        [null, null],
      ],
      cell,
    );
    if (!sheet.ok) throw new Error(sheet.error.detail ?? sheet.error.code);
    expect(sheet.value).toMatchObject({ width: 2 * 136 + 4, height: 3 * 240 + 2 * 4 });
    expect(jpegSize(sheet.value.data)).toEqual({ width: 276, height: 728 });
    const one = await sheetOf(ctx(), work.dir, [[null, b.value.data]], cell);
    if (!one.ok) throw new Error(one.error.detail ?? one.error.code);
    expect(jpegSize(one.value.data)).toEqual({ width: 276, height: 240 });
    const none = await sheetOf(ctx(), work.dir, [[null]], cell);
    if (!none.ok) throw new Error(none.error.detail ?? none.error.code);
    expect(jpegSize(none.value.data)).toEqual({ width: 136, height: 240 });
  });

  it('refuses ragged rows', async () => {
    const ragged = await sheetOf(
      ctx(),
      work.dir,
      [[null, null], [null]],
      cellOf({ width: 9, height: 16 }, 160),
    );
    expect(ragged.ok ? null : ragged.error.code).toBe('core.validation');
  });
});
