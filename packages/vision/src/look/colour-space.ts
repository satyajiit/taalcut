// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * R′G′B′ ↔ Ruderman lαβ (Reinhard 2001) and BT.709 ↔ CIE Lab (D65).
 * The lαβ path is not CIE Lab: Reinhard's transfer is the paper's LMS, then log10.
 */

export type Rgb = readonly [number, number, number];
export type Encoding = 'bt709' | 'bt2020';

/** Paper matrix, four decimals. Inverse below is this matrix inverted once (a 4-dp inverse does not round-trip). */
const LMS_FROM_LINEAR: readonly [Rgb, Rgb, Rgb] = [
  [0.3811, 0.5783, 0.0402],
  [0.1967, 0.7244, 0.0782],
  [0.0241, 0.1288, 0.8444],
];

const LINEAR_FROM_LMS: readonly [Rgb, Rgb, Rgb] = [
  [4.468669863496255, -3.588675903472127, 0.1196043665786012],
  [-1.219716627617763, 2.383087912955457, -0.1626301117514005],
  [0.05850847693854589, -0.2610784390276937, 1.205665908525623],
];

/** Lindbloom sRGB/BT.709, which sums to D65 (95.047, 100, 108.883) on the 0–100 scale. */
const XYZ_FROM_LINEAR: readonly [Rgb, Rgb, Rgb] = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];

const D65: Rgb = [95.047, 100, 108.883];
const CIE_EPS = 216 / 24389;
const CIE_KAPPA = 24389 / 27;

const SQRT3 = Math.sqrt(3);
const SQRT6 = Math.sqrt(6);
const SQRT2 = Math.sqrt(2);
/** log10(0) would poison the pool. Small enough that a saturated primary still round-trips. */
const LOG_FLOOR = 1e-10;

const BT2020_ALPHA = 1.09929682680944;
const BT2020_BETA = 0.018053968510807;
const BT2020_KNEE = 4.5 * BT2020_BETA;

/** Legal-range code value → full-range 0–1. Luma swing 16–235: these bytes are already R′G′B′. */
const LIMITED_BLACK = 16;
const LIMITED_WHITE = 235;

function dot(row: Rgb, v: Rgb): number {
  return row[0] * v[0] + row[1] * v[1] + row[2] * v[2];
}

function apply(matrix: readonly [Rgb, Rgb, Rgb], v: Rgb): Rgb {
  return [dot(matrix[0], v), dot(matrix[1], v), dot(matrix[2], v)];
}

export function encodedToLinear(value: number, encoding: Encoding): number {
  if (encoding === 'bt2020') {
    if (value < BT2020_KNEE) return value / 4.5;
    return ((value + BT2020_ALPHA - 1) / BT2020_ALPHA) ** (1 / 0.45);
  }
  if (value < 0.081) return value / 4.5;
  return ((value + 0.099) / 1.099) ** (1 / 0.45);
}

export function linearToEncoded(linear: number, encoding: Encoding): number {
  if (encoding === 'bt2020') {
    if (linear < BT2020_BETA) return 4.5 * linear;
    return BT2020_ALPHA * linear ** 0.45 - (BT2020_ALPHA - 1);
  }
  if (linear < 0.018) return 4.5 * linear;
  return 1.099 * linear ** 0.45 - 0.099;
}

/** 8-bit code → full-range 0–1. Limited uses the 16–235 luma swing on every channel. */
export function codeToUnit(code: number, range: 'full' | 'limited'): number {
  if (range === 'full') return code / 255;
  const expanded = (code - LIMITED_BLACK) / (LIMITED_WHITE - LIMITED_BLACK);
  if (expanded <= 0) return 0;
  if (expanded >= 1) return 1;
  return expanded;
}

export function encodedToRuderman(rgb: Rgb, encoding: Encoding): Rgb {
  const linear: Rgb = [
    encodedToLinear(rgb[0], encoding),
    encodedToLinear(rgb[1], encoding),
    encodedToLinear(rgb[2], encoding),
  ];
  const lms = apply(LMS_FROM_LINEAR, linear);
  const logL = Math.log10(Math.max(lms[0], LOG_FLOOR));
  const logM = Math.log10(Math.max(lms[1], LOG_FLOOR));
  const logS = Math.log10(Math.max(lms[2], LOG_FLOOR));
  return [(logL + logM + logS) / SQRT3, (logL + logM - 2 * logS) / SQRT6, (logL - logM) / SQRT2];
}

export function rudermanToEncoded(lab: Rgb, encoding: Encoding): Rgb {
  const logL = lab[0] / SQRT3 + lab[1] / SQRT6 + lab[2] / SQRT2;
  const logM = lab[0] / SQRT3 + lab[1] / SQRT6 - lab[2] / SQRT2;
  const logS = lab[0] / SQRT3 - (2 * lab[1]) / SQRT6;
  const linear = apply(LINEAR_FROM_LMS, [10 ** logL, 10 ** logM, 10 ** logS]);
  return [
    linearToEncoded(linear[0], encoding),
    linearToEncoded(linear[1], encoding),
    linearToEncoded(linear[2], encoding),
  ];
}

export function encodedRoundTrip(rgb: Rgb, encoding: Encoding = 'bt709'): Rgb {
  return rudermanToEncoded(encodedToRuderman(rgb, encoding), encoding);
}

function labF(t: number): number {
  return t > CIE_EPS ? Math.cbrt(t) : (CIE_KAPPA * t + 16) / 116;
}

/** Full-range BT.709 R′G′B′ (0–1) → CIE L*a*b* on the usual 0–100 scale. */
export function bt709ToCieLab(rgb: Rgb): Rgb {
  const linear: Rgb = [
    encodedToLinear(rgb[0], 'bt709'),
    encodedToLinear(rgb[1], 'bt709'),
    encodedToLinear(rgb[2], 'bt709'),
  ];
  const xyz = apply(XYZ_FROM_LINEAR, linear);
  const fx = labF((xyz[0] * 100) / D65[0]);
  const fy = labF((xyz[1] * 100) / D65[1]);
  const fz = labF((xyz[2] * 100) / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
