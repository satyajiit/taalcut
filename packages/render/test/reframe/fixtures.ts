// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The reframe eval set's synthetic stand-ins (SPEC P3.16): a clip with a coloured block moving on a known path
 * over a still backdrop (made with the bundled FFmpeg at test time) and its "recorded" subject track, computed
 * from that path the way the helper would report it: detections at 4 Hz (the block as a human, its top as the
 * face) with ±3 px of detection noise, tracker samples at 12 Hz between. Because the motion is known exactly, the
 * ground truth box at every frame is too, so subject-in-frame is measured against the truth, not against the track.
 */
import { join } from 'node:path';
import {
  FrameRate,
  newId,
  RationalTime,
  TimeRange,
  type AssetId,
  type SubjectSample,
  type SubjectTrack,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { SourceRect, VisualFraming } from '../../src/reframe/framing-types';
import { framingCoverage } from '../../src/reframe/subject-coverage';
import { TRACK_RECIPE } from '../../src/reframe/subject-tracker';
import { ffmpeg } from '../support/media';
import { noise } from './support';
import { FIXTURE_H264 } from '../support/host-video';

/** A sine path: centre (cx, cy) ± amplitude over one period, pixels and seconds. */
export interface SineMotion {
  readonly cx: number;
  readonly cy: number;
  readonly ax: number;
  readonly ay: number;
  readonly periodSeconds: number;
}

export interface BlockClipSpec {
  readonly width: number;
  readonly height: number;
  readonly seconds: number;
  readonly fps: number;
  /** The block (the "person"), pixels. */
  readonly block: { readonly width: number; readonly height: number };
  readonly motion: SineMotion;
  /**
   * What stands behind the block. `plain` is one flat colour. `bars` adds still vertical bars of irregular widths
   * and gaps, like any real backdrop: a crop that follows the block pans across them, so the framed picture moves
   * on every frame the crop moves. On a plain backdrop a well-followed block is a still picture (it stays put in
   * the crop), and QA's frozen check then reads that stillness at its noise floor, where the encoder's noise
   * decides the verdict (SPEC P3.2, "Synthetic eval clips").
   */
  readonly backdrop: 'plain' | 'bars';
}

/** 16:9 footage of a subject walking side to side: reframed into 9:16 it must be followed. */
export const LANDSCAPE_SUBJECT: BlockClipSpec = {
  width: 1920,
  height: 1080,
  seconds: 6,
  fps: 30,
  block: { width: 160, height: 720 },
  motion: { cx: 960, cy: 560, ax: 560, ay: 30, periodSeconds: 6 },
  backdrop: 'bars',
};

/** 9:16 footage of a standing person filling most of the height: into 16:9 it is a blurred pad. */
export const PORTRAIT_SUBJECT: BlockClipSpec = {
  width: 1080,
  height: 1920,
  seconds: 4,
  fps: 30,
  block: { width: 360, height: 1500 },
  motion: { cx: 540, cy: 1000, ax: 80, ay: 0, periodSeconds: 4 },
  // The pad test compares the blurred pad's colour with the sharp picture's background: one colour.
  backdrop: 'plain',
};

/** The backdrop's colour, and the bars' (both far from the block's red, and 34 luma levels apart). */
const BACKDROP = '0x202830';
const BAR = '0x3c4c5c';

/**
 * The bars of a `bars` backdrop: left edges and widths in pixels, from a fixed seed, so every clip made from the
 * spec is the same picture. Gaps of 24–96 px and widths of 12–48 px drawn from seeded noise have no period, so no
 * pan lands on the same picture.
 */
export function backdropBars(spec: BlockClipSpec): { x: number; width: number }[] {
  if (spec.backdrop === 'plain') return [];
  const next = noise(29, 1);
  const unit = () => (next() + 1) / 2;
  const gap = () => Math.round(24 + 72 * unit());
  const bars: { x: number; width: number }[] = [];
  let x = gap();
  while (x < spec.width) {
    const width = Math.round(12 + 36 * unit());
    bars.push({ x, width });
    x += width + gap();
  }
  return bars;
}

export function blockCentre(spec: BlockClipSpec, seconds: number): { x: number; y: number } {
  const phase = (2 * Math.PI * seconds) / spec.motion.periodSeconds;
  return {
    x: spec.motion.cx + spec.motion.ax * Math.sin(phase),
    y: spec.motion.cy + spec.motion.ay * Math.sin(phase),
  };
}

const fraction = (spec: BlockClipSpec, x: number, y: number, width: number, height: number): SourceRect => ({
  x: Math.max(0, x / spec.width),
  y: Math.max(0, y / spec.height),
  width: width / spec.width,
  height: height / spec.height,
});

/** The block (the human box) at a time, source fractions. */
export function blockBox(spec: BlockClipSpec, seconds: number): SourceRect {
  const centre = blockCentre(spec, seconds);
  return fraction(
    spec,
    centre.x - spec.block.width / 2,
    centre.y - spec.block.height / 2,
    spec.block.width,
    spec.block.height,
  );
}

/** The block's "face": the middle 60 % of its top fifth, source fractions. */
export function faceBox(spec: BlockClipSpec, seconds: number): SourceRect {
  const centre = blockCentre(spec, seconds);
  const width = spec.block.width * 0.6;
  const height = spec.block.height * 0.2;
  return fraction(spec, centre.x - width / 2, centre.y - spec.block.height / 2, width, height);
}

/** The FFmpeg graph that draws the block on its path over the dark backdrop (and its bars). */
export function blockGraph(spec: BlockClipSpec): string {
  const { motion, block } = spec;
  const phase = `2*PI*t/${motion.periodSeconds}`;
  const x = `${motion.cx - block.width / 2}+${motion.ax}*sin(${phase})`;
  const y = `${motion.cy - block.height / 2}+${motion.ay}*sin(${phase})`;
  const bars = backdropBars(spec).map((bar) => `drawbox=x=${bar.x}:y=0:w=${bar.width}:h=ih:c=${BAR}:t=fill`);
  const backdrop = bars.length > 0 ? `[0:v]${bars.join(',')}[bg];[bg]` : '[0:v]';
  return `${backdrop}[1:v]overlay=x='${x}':y='${y}':eval=frame:shortest=1,format=yuv420p[v]`;
}

/** Writes the clip (H.264 through VideoToolbox, like a camera file) into `dir`; returns its path. */
export async function makeBlockClip(
  ctx: MediaContext,
  dir: string,
  name: string,
  spec: BlockClipSpec,
): Promise<string> {
  const path = join(dir, `${name}.mp4`);
  const size = (width: number, height: number) => `${width}x${height}`;
  await ffmpeg(ctx, [
    '-f',
    'lavfi',
    '-i',
    `color=c=${BACKDROP}:s=${size(spec.width, spec.height)}:r=${spec.fps}:d=${spec.seconds}`,
    '-f',
    'lavfi',
    '-i',
    `color=c=0xf03020:s=${size(spec.block.width, spec.block.height)}:r=${spec.fps}:d=${spec.seconds}`,
    '-filter_complex',
    blockGraph(spec),
    '-map',
    '[v]',
    '-c:v',
    FIXTURE_H264,
    '-b:v',
    '12M',
    path,
  ]);
  return path;
}

const jitterBox = (box: SourceRect, spec: BlockClipSpec, next: () => number): SourceRect => ({
  x: box.x + next() / spec.width,
  y: box.y + next() / spec.height,
  width: box.width,
  height: box.height,
});

/** Vision's top-left boxes for the clip, as `render.trackSubjects` would store them. */
export function recordedTrack(
  spec: BlockClipSpec,
  options: { readonly assetId?: AssetId; readonly noisePx?: number; readonly seed?: number } = {},
): SubjectTrack {
  const rate = FrameRate.of(spec.fps);
  const next = noise(options.seed ?? 17, options.noisePx ?? 3);
  const samples: SubjectSample[] = [];
  const step = 1 / TRACK_RECIPE.trackHz;
  const every = Math.round(TRACK_RECIPE.trackHz / TRACK_RECIPE.detectHz);
  for (let index = 0; index * step < spec.seconds; index++) {
    const seconds = index * step;
    const human = jitterBox(blockBox(spec, seconds), spec, next);
    const face = jitterBox(faceBox(spec, seconds), spec, next);
    const detect = index % every === 0;
    samples.push({
      t: RationalTime.fromSeconds(seconds, rate),
      source: detect ? 'detect' : 'track',
      faces: detect ? [{ box: face, confidence: 0.96, roll: 0, yaw: 0, pitch: 0 }] : [],
      humans: detect ? [{ box: human, confidence: 0.92 }] : [],
      saliency: [],
      subject: {
        kind: detect ? 'union' : 'track',
        box: human,
        focus: { x: face.x + face.width / 2, y: face.y + face.height / 2 },
        confidence: detect ? 0.92 : 0.8,
      },
    });
  }
  return {
    version: 1,
    assetId: options.assetId ?? newId<'Asset'>(),
    contentHash: 'e'.repeat(64),
    range: TimeRange.of(RationalTime.zero(rate), RationalTime.of(spec.seconds * spec.fps, rate)),
    recipe: TRACK_RECIPE,
    compute: { faces: 'neuralEngine', humans: 'neuralEngine', track: 'gpu' },
    samples,
  };
}

/**
 * Subject-in-frame (percent of frames keeping ≥ 95 % of the true face box) of a framing over `frames` output
 * frames, the clip starting at `sourceStartSeconds` and playing in real time at the clip's rate.
 */
export function subjectInFramePercent(
  framing: VisualFraming,
  spec: BlockClipSpec,
  frames: number,
  sourceStartSeconds = 0,
): number {
  const result = framingCoverage(framing, frames, (frame) =>
    faceBox(spec, sourceStartSeconds + frame / spec.fps),
  );
  return result.share * 100;
}
