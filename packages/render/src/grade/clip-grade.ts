// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: a clip's or the whole video's colour (core's Grade) as one affine colour matrix on gamma-encoded sRGB,
 * which the composition applies with an SVG feColorMatrix (color-interpolation-filters sRGB). Preview and export
 * are both drawn by Chrome from the same composition, so they match. Pure.
 *
 * The order: exposure (a gain of 2^stops), temperature and tint (channel gains), contrast about mid grey,
 * saturation about Rec. 709 luma, then the look mixed in by its strength. A clip's grade is applied first, then
 * the whole video's.
 */
import { isNeutralGrade, type Grade } from '@taalcut/core';

/** Rows R, G, B: [r, g, b, offset]; alpha passes through. */
export type ColourMatrix = readonly [readonly number[], readonly number[], readonly number[]];

export const IDENTITY_MATRIX: ColourMatrix = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
];

const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** `second` after `first`, as one matrix. */
export function composeMatrices(first: ColourMatrix, second: ColourMatrix): ColourMatrix {
  const row = (r: readonly number[]): number[] => [
    r[0]! * first[0][0]! + r[1]! * first[1][0]! + r[2]! * first[2][0]!,
    r[0]! * first[0][1]! + r[1]! * first[1][1]! + r[2]! * first[2][1]!,
    r[0]! * first[0][2]! + r[1]! * first[1][2]! + r[2]! * first[2][2]!,
    r[0]! * first[0][3]! + r[1]! * first[1][3]! + r[2]! * first[2][3]! + r[3]!,
  ];
  return [row(second[0]), row(second[1]), row(second[2])];
}

const chain = (...matrices: readonly ColourMatrix[]) => matrices.reduce(composeMatrices, IDENTITY_MATRIX);

const gains = (r: number, g: number, b: number): ColourMatrix => [
  [r, 0, 0, 0],
  [0, g, 0, 0],
  [0, 0, b, 0],
];

function contrastMatrix(amount: number): ColourMatrix {
  const k = 1 + amount;
  const lift = 0.5 * (1 - k);
  return [
    [k, 0, 0, lift],
    [0, k, 0, lift],
    [0, 0, k, lift],
  ];
}

function saturationMatrix(amount: number): ColourMatrix {
  const s = 1 + amount;
  const row = (channel: number) => [0, 1, 2].map((i) => (1 - s) * LUMA[i]! + (i === channel ? s : 0)).concat(0);
  return [row(0), row(1), row(2)];
}

/** Warm (+) lifts red and lowers blue; magenta (+) lowers green. */
const temperatureMatrix = (amount: number) => gains(1 + 0.12 * amount, 1, 1 - 0.12 * amount);
const tintMatrix = (amount: number) => gains(1 + 0.03 * amount, 1 - 0.1 * amount, 1 + 0.03 * amount);

/** Blacks lifted by `amount` (a faded print). */
const liftMatrix = (amount: number): ColourMatrix => [
  [1 - amount, 0, 0, amount],
  [0, 1 - amount, 0, amount],
  [0, 0, 1 - amount, amount],
];

/** Each named look at full strength. */
const LOOKS: Record<NonNullable<Grade['look']>, ColourMatrix> = {
  vivid: chain(contrastMatrix(0.12), saturationMatrix(0.35)),
  muted: chain(contrastMatrix(-0.08), saturationMatrix(-0.35)),
  warm: chain(temperatureMatrix(0.45), saturationMatrix(0.05)),
  cool: chain(temperatureMatrix(-0.45), tintMatrix(-0.05)),
  mono: chain(saturationMatrix(-1), contrastMatrix(0.1)),
  vintage: chain(saturationMatrix(-0.25), temperatureMatrix(0.3), contrastMatrix(-0.1), liftMatrix(0.04)),
  faded: chain(contrastMatrix(-0.25), saturationMatrix(-0.15), liftMatrix(0.06)),
  cinematic: chain(contrastMatrix(0.15), saturationMatrix(-0.1), temperatureMatrix(0.12), tintMatrix(-0.05)),
};

/** `matrix` mixed with the identity: none at 0, all of it at 1. */
function strengthOf(matrix: ColourMatrix, strength: number): ColourMatrix {
  const mix = (row: readonly number[], identity: readonly number[]) =>
    row.map((value, index) => identity[index]! + strength * (value - identity[index]!));
  return [mix(matrix[0], IDENTITY_MATRIX[0]), mix(matrix[1], IDENTITY_MATRIX[1]), mix(matrix[2], IDENTITY_MATRIX[2])];
}

/** One grade as a matrix. */
export function gradeMatrix(grade: Grade): ColourMatrix {
  const exposure = 2 ** grade.exposure;
  return chain(
    gains(exposure, exposure, exposure),
    temperatureMatrix(grade.temperature),
    tintMatrix(grade.tint),
    contrastMatrix(grade.contrast),
    saturationMatrix(grade.saturation),
    grade.look ? strengthOf(LOOKS[grade.look], grade.lookStrength) : IDENTITY_MATRIX,
  );
}

/** A clip's grade then the whole video's, as one matrix; null when neither changes anything. */
export function visualGradeMatrix(grades: readonly (Grade | undefined)[]): ColourMatrix | null {
  const real = grades.filter((grade): grade is Grade => grade !== undefined && !isNeutralGrade(grade));
  return real.length === 0 ? null : chain(...real.map(gradeMatrix));
}

/** A matrix applied to one sRGB colour (0–1 per channel), clamped like the filter. */
export function applyMatrix(matrix: ColourMatrix, [r, g, b]: readonly [number, number, number]): [number, number, number] {
  const channel = (row: readonly number[]) => Math.min(1, Math.max(0, row[0]! * r + row[1]! * g + row[2]! * b + row[3]!));
  return [channel(matrix[0]), channel(matrix[1]), channel(matrix[2])];
}

/** feColorMatrix's `values`: twenty numbers, row by row, alpha passed through; six decimals. */
export function feColorMatrixValues(matrix: ColourMatrix): string {
  const round = (value: number) => Number(value.toFixed(6));
  const rows = matrix.map((row) => [row[0]!, row[1]!, row[2]!, 0, row[3]!].map(round));
  return [...rows.flat(), 0, 0, 0, 1, 0].join(' ');
}
