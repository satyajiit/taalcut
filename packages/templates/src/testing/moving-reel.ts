// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: synthetic reels of two moving pictures (FFmpeg's `testsrc2`, which scrolls, then `mandelbrot`, which
 * zooms) joined at frame 90 by a dissolve, by a fade through black or by a hard cut, for the tests of the pixel
 * transition finder (breakdown/gradual.ts) and of what assembly makes of a found transition. Unlike
 * synthetic-reel.ts's flat colours these have a picture to blend, as footage has. lavfi only, 270×480 at 30 fps.
 */
import { DEFAULT_REEL_ENCODER } from './synthetic-reel';

export type MovingReelJoin = 'dissolve' | 'fadeBlack' | 'cut';

/** Where the second picture comes in, and how long each reel is, in frames. */
export const MOVING_REEL = {
  join: 90,
  frames: 180,
  /** The dissolve: frames 91 to 99 hold both pictures; 90 is the last of the first, 100 the first of the second. */
  dissolve: { start: 91, end: 99 },
  /** The fade: the first picture darkens over frames 82 to 89, the second comes up from black over 90 to 97. */
  fade: { start: 82, end: 97 },
} as const;

/** The FFmpeg argv (no shell) that writes the reel to `out` (mp4, H.264 on `encoder`, no sound). */
export function movingReelArgs(
  join: MovingReelJoin,
  out: string,
  options: { readonly encoder?: string } = {},
): string[] {
  const size = 's=270x480:r=30';
  const { join: at, frames } = MOVING_REEL;
  const first = `[0:v]trim=end_frame=${join === 'dissolve' ? at + 10 : at},setpts=PTS-STARTPTS,format=yuv420p,settb=1/30`;
  const second = `[1:v]trim=end_frame=${frames - at},setpts=PTS-STARTPTS,format=yuv420p,settb=1/30`;
  const graph =
    join === 'dissolve'
      ? `${first}[a];${second}[b];[a][b]xfade=transition=fade:duration=${(10 / 30).toFixed(6)}:offset=${(at / 30).toFixed(6)}[v]`
      : join === 'fadeBlack'
        ? `${first},fade=t=out:s=${at - 8}:n=8[a];${second},fade=t=in:s=0:n=8[b];[a][b]concat=n=2:v=1:a=0[v]`
        : `${first}[a];${second}[b];[a][b]concat=n=2:v=1:a=0[v]`;
  return [
    ...['-hide_banner', '-loglevel', 'error', '-y'],
    ...['-f', 'lavfi', '-i', `testsrc2=${size}`, '-f', 'lavfi', '-i', `mandelbrot=${size}`],
    ...[
      '-filter_complex',
      `${graph};[v]trim=end_frame=${frames},setpts=PTS-STARTPTS[vout]`,
      '-map',
      '[vout]',
    ],
    ...['-c:v', options.encoder ?? DEFAULT_REEL_ENCODER, '-b:v', '3M', '-pix_fmt', 'yuv420p'],
    ...['-r', '30', '-fps_mode', 'cfr', out],
  ];
}
