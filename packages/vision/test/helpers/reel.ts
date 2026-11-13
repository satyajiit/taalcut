// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Synthetic footage made with the bundled FFmpeg at test time: lavfi sources
 * cut at known frames, so cuts and shots have exact labels. Media's
 * `buildSyntheticReel` (test-support) makes flat-colour cuts with overlays
 * and clicks; vision's sets need textured sources, per-segment filters
 * (blur, shake, flashes), fractional rates (29.97) and dissolves, so they
 * keep this builder. The software encoder comes first: parallel VideoToolbox
 * encodes from several test runs have panicked this Mac's video encoder.
 */
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { softwareH264FixtureFlags, testFfmpegFor } from '@taalcut/media/test-support';
import { inject } from 'vitest';

/**
 * The development FFmpeg, checked once per test run before any file starts (ffmpeg-setup.ts; media's
 * test-support-ffmpeg.ts). Suites skip when there is none; any other failure of the check has stopped the run.
 */
export async function testMedia(suite: string): Promise<{ ctx?: MediaContext; skip: string }> {
  const { binaries, skip } = testFfmpegFor(inject('testFfmpeg'), suite);
  return binaries ? { ctx: { binaries }, skip: '' } : { skip };
}

export interface Segment {
  /** A lavfi video source without size/rate, e.g. 'testsrc2', 'smptebars', 'mandelbrot', 'color=c=red'. */
  readonly source: string;
  readonly frames: number;
  /** Extra filters on this segment, e.g. 'hue=h=90' or 'eq=brightness=0.3'. */
  readonly filter?: string;
}

export interface ReelOptions {
  readonly width: number;
  readonly height: number;
  /** '30', '25', '30000/1001'. */
  readonly rate: string;
  /** Dissolve into segment i (i ≥ 1) over this many frames. */
  readonly dissolves?: Readonly<Record<number, number>>;
}

/** Cut frames (first frame of each new shot) of a reel built from these segments. */
export function cutFrames(segments: readonly Segment[]): number[] {
  const cuts: number[] = [];
  let at = 0;
  for (const segment of segments.slice(0, -1)) {
    at += segment.frames;
    cuts.push(at);
  }
  return cuts;
}

/** Writes an H.264 MP4 of the segments, hard cuts unless `dissolves` says otherwise. */
export async function makeReel(
  ctx: MediaContext,
  out: string,
  segments: readonly Segment[],
  options: ReelOptions,
): Promise<void> {
  const { width, height, rate } = options;
  const dissolves = options.dissolves ?? {};
  const inputs: string[] = [];
  const chains: string[] = [];
  segments.forEach((segment, i) => {
    const base = segment.source.includes('=') ? `${segment.source}:` : `${segment.source}=`;
    inputs.push('-f', 'lavfi', '-i', `${base}size=${width}x${height}:rate=${rate}`);
    const extra = segment.filter ? `,${segment.filter}` : '';
    // A shot that dissolves into the next plays on through the dissolve's second half: xfade cuts a dissolve
    // short, straight to the next shot, where its first input ends early.
    const into = dissolves[i + 1] ?? 0;
    const frames = segment.frames + into - Math.floor(into / 2);
    chains.push(`[${i}:v]trim=end_frame=${frames},setpts=PTS-STARTPTS,format=yuv420p${extra}[s${i}]`);
  });
  let last = 's0';
  let length = segments[0]?.frames ?? 0;
  const [num, den = '1'] = rate.split('/');
  const fps = Number(num) / Number(den);
  const tb = `${den}/${num}`;
  for (let i = 1; i < segments.length; i++) {
    const frames = dissolves[i];
    const label = `j${i}`;
    if (frames) {
      // xfade's offset is where the transition starts; the dissolve is centred on the labelled cut.
      const offset = (length - Math.floor(frames / 2)) / fps;
      chains.push(
        `[${last}][s${i}]xfade=transition=fade:duration=${frames / fps}:offset=${offset},settb=${tb}[${label}]`,
      );
      // The second input starts at the offset (its first frames are the dissolve's) and plays to its end.
      length += (segments[i]?.frames ?? 0) - Math.floor(frames / 2);
    } else {
      // concat's output time base is 1/1000000; xfade needs both inputs on one, so every join ends on the grid's.
      chains.push(`[${last}][s${i}]concat=n=2:v=1:a=0,settb=${tb}[${label}]`);
      length += segments[i]?.frames ?? 0;
    }
    last = label;
  }
  const made = await runFfmpeg(ctx, [
    '-y',
    ...inputs,
    '-filter_complex',
    chains.join(';'),
    '-map',
    `[${last}]`,
    '-r',
    rate,
    ...softwareH264FixtureFlags(),
    '-b:v',
    '4M',
    '-pix_fmt',
    'yuv420p',
    out,
  ]);
  if (!made.ok) throw new Error(`makeReel failed: ${made.error.code} ${made.error.detail ?? ''}`);
}
