// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's speed curve as FFmpeg filters (SPEC section 3, "Speed"): `setpts` that moves every source
 * frame to the output time the curve puts it at, so the conform's `fps` filter then picks, for each
 * output frame, the source frame nearest the curve; and the sound as pieces of constant `atempo`
 * played back to back, each cut to its exact sample count. Pure text, no FFmpeg run.
 */
import type { FrameRate } from '@taalcut/core';
import { balancedIf, exprDecimal } from './filter-expression';
import { curveKnots, type CurveKnot, type SpeedCurve, type TempoPiece } from './speed-curve';

/** atempo takes 0.5 to 100 per instance; slower speeds chain halves (0.1 = 0.5 · 0.5 · 0.5 · 0.8). */
export function atempoChain(tempo: number): number[] {
  if (!Number.isFinite(tempo) || tempo <= 0 || Math.abs(tempo - 1) < 1e-6) return [];
  const factors: number[] = [];
  let rest = tempo;
  while (rest < 0.5) {
    factors.push(0.5);
    rest /= 0.5;
  }
  while (rest > 100) {
    factors.push(100);
    rest /= 100;
  }
  if (Math.abs(rest - 1) > 1e-6) factors.push(Number(rest.toFixed(6)));
  return factors;
}

const decimal = (value: number) => exprDecimal(value, 9);

/** Output seconds for source seconds `ld(0)` on the segment from `knots[index]` (the first and last extend). */
function leaf(knots: readonly CurveKnot[], index: number, fps: number): string {
  const from = knots[index]!;
  const to = knots[index + 1]!;
  const slope = (to.out - from.out) / (to.src - from.src);
  return `${decimal(from.out / fps)}+(ld(0)-${decimal(from.src / fps)})*${decimal(slope)}`;
}

/** A balanced `if` tree over segments [low, high] on the source time in ld(0). */
const tree = (knots: readonly CurveKnot[], low: number, high: number, fps: number): string =>
  balancedIf(
    {
      variable: 'ld(0)',
      leaf: (index) => leaf(knots, index, fps),
      start: (index) => {
        const knot = knots[index];
        return knot ? decimal(knot.src / fps) : null;
      },
    },
    low,
    high,
  );

/**
 * The `setpts` filter for `frames` output frames of `curve`. Real time is a plain reset; a ramp maps
 * source time (from the first frame) through straight lines between the curve's knots, which stay
 * within 1/100 of a frame of the integral.
 *
 * The `fps` filter after it (round=near) shows at output frame k the last source frame whose new
 * time is under k + ½. The curve is moved half a frame along both axes, so that is the source frame
 * nearest the curve (source time under S(k) + ½), as real time already gets; before the first half
 * frame it stays real time, so the first frame keeps time zero.
 */
export function speedFilter(curve: SpeedCurve, frames: number, rate: FrameRate): string {
  const knots = curve.ramp ? curveKnots(curve, frames) : [];
  if (knots.length < 2) return 'setpts=PTS-STARTPTS';
  const fps = rate.num / rate.den;
  const shifted = [
    { out: 0, src: 0 },
    ...knots.map((knot) => ({ out: knot.out + 0.5, src: knot.src + 0.5 })),
  ];
  return `setpts='st(0,T-STARTT);(${tree(shifted, 0, shifted.length - 2, fps)})/TB'`;
}

function pieceSteps(piece: TempoPiece, from: number): string[] {
  const tempo = piece.samples > 0 ? piece.consumed / piece.samples : 1;
  return [
    `atrim=start_sample=${from}:end_sample=${from + piece.consumed}`,
    'asetpts=PTS-STARTPTS',
    ...atempoChain(tempo).map((factor) => `atempo=${factor}`),
    // Pad a short piece and cut a long one: atempo's output length is only close to exact.
    `apad=whole_len=${piece.samples}`,
    `atrim=end_sample=${piece.samples}`,
  ];
}

/**
 * Graph text that plays `pieces` back to back, each at its own tempo, for use inside a chain
 * (`…,${tempoFragment(pieces, 's0')},…`): it splits the stream, trims each piece's source samples,
 * stretches the piece and makes it exactly its length, then concatenates. Labels start with `tag`,
 * so several fragments can share one graph.
 */
export function tempoFragment(pieces: readonly TempoPiece[], tag: string): string {
  if (pieces.length === 1) return pieceSteps(pieces[0]!, 0).join(',');
  const split = pieces.map((_, index) => `[${tag}p${index}]`).join('');
  const joined = pieces.map((_, index) => `[${tag}q${index}]`).join('');
  let consumed = 0;
  const branches = pieces.map((piece, index) => {
    const steps = pieceSteps(piece, consumed);
    consumed += piece.consumed;
    return `[${tag}p${index}]${steps.join(',')}[${tag}q${index}]`;
  });
  return `asplit=${pieces.length}${split};${branches.join(';')};${joined}concat=n=${pieces.length}:v=0:a=1`;
}
