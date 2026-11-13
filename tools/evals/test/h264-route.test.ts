// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LNX1-PKG: the evals' H.264 route follows what the bundled build lists, not the OS. */
import { describe, expect, it } from 'vitest';
import { bundledFfmpeg } from '../src/ffmpeg-bin';
import { h264Route, h264RouteFor } from '../src/h264-route';

describe('h264RouteFor', () => {
  it('takes VideoToolbox where the build has it, and libopenh264 with software decode where not', () => {
    expect(h264RouteFor(new Set(['h264_videotoolbox', 'libopenh264']))).toEqual({
      decode: ['-hwaccel', 'videotoolbox'],
      encoder: 'h264_videotoolbox',
    });
    expect(h264RouteFor(new Set(['libopenh264', 'h264_nvenc']))).toEqual({
      decode: [],
      encoder: 'libopenh264',
    });
    expect(() => h264RouteFor(new Set(['mjpeg']))).toThrow(/neither h264_videotoolbox nor libopenh264/);
  });

  const bins = bundledFfmpeg();
  it.skipIf(!bins)(
    'finds a route in the bundled build of this platform (skipped without a fetched or built FFmpeg)',
    async () => {
      expect((await h264Route(bins!.ffmpeg)).encoder).toMatch(/^(h264_videotoolbox|libopenh264)$/);
    },
  );
});
