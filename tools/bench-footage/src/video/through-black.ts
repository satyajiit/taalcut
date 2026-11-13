// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Scripted clips' transitions through black and their low-key shots (IX3-D1), as filter chains for graph.ts.
 *
 * - Through black: the clip so far fades out over its last `out` seconds (FFmpeg's `fade`, to video black), clean
 *   black (no grain, as an editor's black) holds for `hold`, and the next shot fades in over its first `in`; a side
 *   of 0 is a hard cut. The fades come after each shot's grain, so the black at a fade's bottom is black.
 * - Dark: the shot's level scaled down toward video black (16) by a factor drifting between 0.05 and 0.15 over
 *   four seconds, colour with it: dark throughout, and now and then black by blackdetect's rule (98 % of pixels
 *   under 10 % of full scale), as night footage is. The bundled LGPL FFmpeg has no `eq`, so `geq` draws it.
 */
import type { FadeEntry } from '../sets/types';

const DARK = '(0.10+0.05*sin(2*PI*T/4))';

/** The filter that turns a shot's picture low-key. */
export const DARK_FILTER =
  `geq=lum='16+(lum(X\\,Y)-16)*${DARK}'` +
  `:cb='128+(cb(X\\,Y)-128)*${DARK}*3':cr='128+(cr(X\\,Y)-128)*${DARK}*3'`;

interface BlackJoin {
  /** The clip so far, and how long it is (seconds). */
  readonly before: string;
  readonly length: number;
  /** The next shot's label. */
  readonly next: string;
  readonly fade: FadeEntry;
  /** Labels made here are numbered by the next shot's index. */
  readonly index: number;
  readonly picture: { readonly width: number; readonly height: number; readonly fps: number };
}

/** The chains that join the clip so far to the next shot through black, ending in `out`. */
export function throughBlack(join: BlackJoin, out: string): string[] {
  const { fade, index, picture } = join;
  const chains: string[] = [];
  let before = join.before;
  if (fade.out > 0) {
    const start = Math.round((join.length - fade.out) * 1000) / 1000;
    chains.push(`${before}fade=t=out:st=${start}:d=${fade.out}[fadeout${index}]`);
    before = `[fadeout${index}]`;
  }
  let next = join.next;
  if (fade.in > 0) {
    chains.push(`${next}fade=t=in:st=0:d=${fade.in}[fadein${index}]`);
    next = `[fadein${index}]`;
  }
  if (fade.hold <= 0) return [...chains, `${before}${next}concat=n=2:v=1:a=0${out}`];
  const { width, height, fps } = picture;
  return [
    ...chains,
    `color=c=black:s=${width}x${height}:r=${fps}:d=${fade.hold},format=yuv420p,setsar=1,settb=AVTB[black${index}]`,
    `${before}[black${index}]${next}concat=n=3:v=1:a=0${out}`,
  ];
}
