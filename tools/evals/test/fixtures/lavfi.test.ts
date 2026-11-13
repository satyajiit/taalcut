// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The one lavfi clip encode the casting and template fit fixtures share (LRN1-FIX). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundledFfmpeg } from '../../src/ffmpeg-bin';
import { runFfmpeg } from '../../src/ffmpeg-run';
import { encodeLavfiClips } from '../../src/fixtures/lavfi';
import { decodeFrames } from '../../src/render/encode';
import { STARTS_PROCESSES } from '../starts-processes';

const bins = bundledFfmpeg();
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(bins === undefined)('encodeLavfiClips', STARTS_PROCESSES, () => {
  it('writes each clip with its own frames and filter, as lossless video with no sound', async () => {
    if (bins === undefined) throw new Error('ffmpeg is not available');
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-lavfi-'));
    dirs.push(dir);
    const red = join(dir, 'red.mkv');
    const pan = join(dir, 'pan.mkv');
    await encodeLavfiClips(bins.ffmpeg, [
      { source: 'color=c=red:s=8x8:r=30:d=1', frames: 3, path: red },
      // A tall field cropped to 8x8: five frames of that size only if the filter ran.
      { source: 'color=c=blue:s=8x16:r=30:d=1', frames: 5, filter: 'crop=8:8:x=0:y=min(n\\,8)', path: pan },
    ]);
    expect(await decodeFrames(bins.ffmpeg, red, 8, 8)).toHaveLength(3);
    expect(await decodeFrames(bins.ffmpeg, pan, 8, 8)).toHaveLength(5);
    for (const path of [red, pan]) {
      const streams = await runFfmpeg(bins.ffprobe, [
        ...['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', path],
      ]);
      expect(streams.toString('utf8').trim()).toBe('ffv1,video');
    }
  });
});
