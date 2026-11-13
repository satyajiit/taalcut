// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Each look as an FFmpeg source, moving the whole shot long: a zooming Mandelbrot, a test pattern with
 * moving parts, Conway's life and a scrolling automaton (scaled up without smoothing), drifting gradients,
 * colour bars, and a camera pan or zoom over a large still made once per shot. Expensive generators render
 * below the clip's size and are scaled up; every look's parameters come from its shot's seed.
 */
import { seeded } from '../random';
import type { Look } from '../plan';

export interface LookSource {
  /** A source filter chain producing the shot's picture, or null when the shot reads a still (pan, zoom). */
  readonly source: string | null;
  /** The chain to apply to the still input, for pan and zoom. */
  readonly onStill: string | null;
  readonly scaleFlags: 'bicubic' | 'neighbor';
}

export interface StillSpec {
  readonly width: number;
  readonly height: number;
  /** One frame of this source, at `width` × `height`. */
  readonly source: string;
}

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

/** Places in the Mandelbrot set with detail at every zoom. */
const CENTRES = [
  [-0.743643887, 0.131825904],
  [-0.1011, 0.9563],
  [-1.25066, 0.02012],
  [0.001643721971153, -0.822467633298876],
  [-0.77568377, 0.13646737],
] as const;

const colour = (value: number) =>
  `0x${Math.floor(value * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`;

export interface LookContext {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly seconds: number;
  readonly seed: number;
}

/** The large still a pan or zoom moves over: 1.6 × the clip, rendered at 0.8 × and doubled. */
export function stillFor(context: LookContext): StillSpec {
  const random = seeded(context.seed ^ 0x5bd1e995);
  const [x, y] = random.pick(CENTRES);
  const width = even(context.width * 0.8);
  const height = even(context.height * 0.8);
  return {
    width: width * 2,
    height: height * 2,
    source:
      `mandelbrot=size=${width}x${height}:rate=1:maxiter=300:start_x=${x}:start_y=${y}` +
      `:start_scale=${random.between(0.01, 0.2, 4)}:end_scale=${random.between(0.01, 0.2, 4)},` +
      `hue=h=${random.int(0, 359)}:s=${random.between(0.8, 1.6)},scale=${width * 2}:${height * 2}:flags=bicubic`,
  };
}

export function lookSource(look: Look, context: LookContext): LookSource {
  const random = seeded(context.seed);
  const { width: w, height: h, fps, seconds } = context;
  const frames = Math.round(seconds * fps);
  switch (look) {
    case 'fractal': {
      const [x, y] = random.pick(CENTRES);
      return {
        source:
          `mandelbrot=size=${even(w / 4)}x${even(h / 4)}:rate=${fps}:maxiter=160:start_x=${x}:start_y=${y}` +
          `:start_scale=${random.between(1.5, 3)}:end_scale=${random.between(0.002, 0.05, 4)}:end_pts=${frames},` +
          `hue=h=${random.int(0, 359)}`,
        onStill: null,
        scaleFlags: 'bicubic',
      };
    }
    case 'pattern':
      return {
        source: `testsrc2=size=${even(w / 2)}x${even(h / 2)}:rate=${fps},hue=h=${random.int(0, 359)}`,
        onStill: null,
        scaleFlags: 'bicubic',
      };
    case 'life':
      return {
        source:
          `life=size=${even(w / 8)}x${even(h / 8)}:rate=${fps}:seed=${random.int(1, 1_000_000)}:ratio=0.3:mold=8` +
          `:life_color=${colour(random.next())}:death_color=${colour(random.next() * 0.3)}:mold_color=${colour(random.next())}`,
        onStill: null,
        scaleFlags: 'neighbor',
      };
    case 'cells':
      return {
        source:
          `cellauto=size=${even(w / 8)}x${even(h / 8)}:rate=${fps}:rule=${random.pick([18, 30, 45, 73, 90, 105, 110, 150])}` +
          `:seed=${random.int(1, 1_000_000)}:random_fill_ratio=0.5`,
        onStill: null,
        scaleFlags: 'neighbor',
      };
    case 'gradient':
      return {
        source:
          `gradients=size=${even(w / 2)}x${even(h / 2)}:rate=${fps}:speed=${random.between(0.01, 0.04, 3)}` +
          `:seed=${random.int(1, 1_000_000)}:nb_colors=${random.int(3, 6)}:type=${random.pick(['linear', 'radial', 'circular', 'spiral'])}`,
        onStill: null,
        scaleFlags: 'bicubic',
      };
    case 'bars':
      return { source: `smptehdbars=size=${w}x${h}:rate=${fps}`, onStill: null, scaleFlags: 'bicubic' };
    case 'pan': {
      // Across the still, left to right or back, with a slow vertical sway.
      const forward = random.next() < 0.5;
      const sway = random.between(0.2, 0.6);
      const x = forward ? `(iw-ow)*t/${seconds}` : `(iw-ow)*(1-t/${seconds})`;
      return {
        source: null,
        onStill: `crop=w=${w}:h=${h}:x='${x}':y='(ih-oh)*(0.5+0.4*sin(t*${sway}))'`,
        scaleFlags: 'bicubic',
      };
    }
    case 'zoom': {
      const depth = random.between(0.3, 0.8);
      return {
        source: null,
        onStill:
          `zoompan=z='1+${depth}*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
          `:d=1:s=${w}x${h}:fps=${fps}`,
        scaleFlags: 'bicubic',
      };
    }
  }
}
