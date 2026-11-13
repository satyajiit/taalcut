// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The synthetic clips the casting and template fit suites label by construction: each one a lavfi source (a solid
 * colour, a tall colour field, testsrc2) encoded with the bundled FFmpeg. Lossless ffv1, so a clip decodes to the
 * exact frames it was made from; the caller checks that with `assertLosslessEncode` first.
 */
import { runFfmpeg } from '../ffmpeg-run';

export interface LavfiClip {
  /** The lavfi source, e.g. `color=c=red:s=32x64:r=30:d=1`. */
  readonly source: string;
  /** Frames written: the output stops there, whatever the source's length. */
  readonly frames: number;
  /** A filter between source and encoder, e.g. a crop that pans. */
  readonly filter?: string;
  /** Where the clip is written. */
  readonly path: string;
}

/**
 * Every clip in one FFmpeg run, an input and an output each. (A run per clip was a process start each, which on a
 * busy machine took seconds. UX2 round 2.)
 */
export async function encodeLavfiClips(ffmpeg: string, clips: readonly LavfiClip[]): Promise<void> {
  await runFfmpeg(ffmpeg, [
    ...['-y', '-hide_banner', '-loglevel', 'error'],
    ...clips.flatMap(({ source }) => ['-f', 'lavfi', '-i', source]),
    ...clips.flatMap(({ frames, filter, path }, index) => [
      ...['-map', `${index}:v`, ...(filter === undefined ? [] : ['-vf', filter])],
      ...['-frames:v', String(frames), '-c:v', 'ffv1', '-an', path],
    ]),
  ]);
}
