// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MORE1: a colour grade as the matrix the video is drawn with, for the colour sheet's swatches and the Colour
 * tile's chip, so a look's card shows the scene's own frame as the look will leave it. Render owns this sum
 * (packages/render/src/grade/clip-grade.ts: one affine matrix on gamma-encoded sRGB, in an SVG feColorMatrix)
 * and the renderer may not import it, so the same recipe is restated here, for drawing only: the viewer above
 * is the truth, and it is drawn by render. Keep the two in step. Pure.
 *
 * The order, as in render: exposure (a gain of 2^stops), temperature and tint (channel gains), contrast about
 * mid grey, saturation about Rec. 709 luma, then the look mixed in by its strength. The highlight curves
 * (`highlights`, `whites`) are not a matrix and are left out of a swatch.
 */
import { NEUTRAL_GRADE, type Grade, type GradeLook } from '@taalcut/core';

/** Rows R, G, B: [r, g, b, offset]; alpha passes through. */
export type ColourMatrix = readonly [readonly number[], readonly number[], readonly number[]];

const IDENTITY: ColourMatrix = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
];
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** `second` after `first`, as one matrix. */
function compose(first: ColourMatrix, second: ColourMatrix): ColourMatrix {
  const row = (r: readonly number[]): number[] => [
    r[0]! * first[0][0]! + r[1]! * first[1][0]! + r[2]! * first[2][0]!,
    r[0]! * first[0][1]! + r[1]! * first[1][1]! + r[2]! * first[2][1]!,
    r[0]! * first[0][2]! + r[1]! * first[1][2]! + r[2]! * first[2][2]!,
    r[0]! * first[0][3]! + r[1]! * first[1][3]! + r[2]! * first[2][3]! + r[3]!,
  ];
  return [row(second[0]), row(second[1]), row(second[2])];
}
const chain = (...matrices: readonly ColourMatrix[]) => matrices.reduce(compose, IDENTITY);

const gains = (r: number, g: number, b: number): ColourMatrix => [
  [r, 0, 0, 0],
  [0, g, 0, 0],
  [0, 0, b, 0],
];
function contrast(amount: number): ColourMatrix {
  const k = 1 + amount;
  const lift = 0.5 * (1 - k);
  return [
    [k, 0, 0, lift],
    [0, k, 0, lift],
    [0, 0, k, lift],
  ];
}
function saturation(amount: number): ColourMatrix {
  const s = 1 + amount;
  const row = (channel: number) =>
    [0, 1, 2].map((i) => (1 - s) * LUMA[i]! + (i === channel ? s : 0)).concat(0);
  return [row(0), row(1), row(2)];
}
/** Warm (+) lifts red and lowers blue; magenta (+) lowers green. */
const temperature = (amount: number) => gains(1 + 0.12 * amount, 1, 1 - 0.12 * amount);
const tint = (amount: number) => gains(1 + 0.03 * amount, 1 - 0.1 * amount, 1 + 0.03 * amount);
/** Blacks lifted by `amount` (a faded print). */
const lift = (amount: number): ColourMatrix => [
  [1 - amount, 0, 0, amount],
  [0, 1 - amount, 0, amount],
  [0, 0, 1 - amount, amount],
];

/** Each named look at full strength. */
const LOOKS: Readonly<Record<GradeLook, ColourMatrix>> = {
  vivid: chain(contrast(0.12), saturation(0.35)),
  muted: chain(contrast(-0.08), saturation(-0.35)),
  warm: chain(temperature(0.45), saturation(0.05)),
  cool: chain(temperature(-0.45), tint(-0.05)),
  mono: chain(saturation(-1), contrast(0.1)),
  vintage: chain(saturation(-0.25), temperature(0.3), contrast(-0.1), lift(0.04)),
  faded: chain(contrast(-0.25), saturation(-0.15), lift(0.06)),
  cinematic: chain(contrast(0.15), saturation(-0.1), temperature(0.12), tint(-0.05)),
};

function mixed(matrix: ColourMatrix, strength: number): ColourMatrix {
  const mix = (row: readonly number[], identity: readonly number[]) =>
    row.map((value, index) => identity[index]! + strength * (value - identity[index]!));
  return [mix(matrix[0], IDENTITY[0]), mix(matrix[1], IDENTITY[1]), mix(matrix[2], IDENTITY[2])];
}

/** One grade as a matrix; what is missing is as shot. */
export function gradeMatrix(patch: Partial<Grade> | null | undefined): ColourMatrix {
  const grade: Grade = { ...NEUTRAL_GRADE, ...patch };
  const exposure = 2 ** grade.exposure;
  return chain(
    gains(exposure, exposure, exposure),
    temperature(grade.temperature),
    tint(grade.tint),
    contrast(grade.contrast),
    saturation(grade.saturation),
    grade.look ? mixed(LOOKS[grade.look], grade.lookStrength) : IDENTITY,
  );
}

/** A scene's grade, then the whole video's on top of it, as feColorMatrix's twenty `values`. */
export function gradeFilterValues(
  scene: Partial<Grade> | null | undefined,
  video?: Partial<Grade> | null | undefined,
): string {
  const matrix = chain(gradeMatrix(scene), gradeMatrix(video));
  const round = (value: number) => Number(value.toFixed(6));
  const rows = matrix.map((row) => [row[0]!, row[1]!, row[2]!, 0, row[3]!].map(round));
  return [...rows.flat(), 0, 0, 0, 1, 0].join(' ');
}
