// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CIEDE2000 (Sharma, Wu, Dalal 2005), including the 2π hue adjustments.
 * Mean ΔE is per pixel: averaging the colours first hides a bad face against a matched sky.
 */
import { bt709ToCieLab, type Rgb } from './colour-space';
import { percentile } from './percentile';

export type CieLab = readonly [number, number, number];

const RAD = Math.PI / 180;
const POW7_25 = 25 ** 7;

function hueDegrees(b: number, ap: number): number {
  if (ap === 0 && b === 0) return 0;
  const degrees = Math.atan2(b, ap) / RAD;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** ΔE00 for two CIE L*a*b* triples (L on 0–100). kL = kC = kH = 1. */
export function ciede2000(lab1: CieLab, lab2: CieLab): number {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + POW7_25)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1 = hueDegrees(b1, a1p);
  const h2 = hueDegrees(b2, a2p);

  let dh: number;
  if (c1p * c2p === 0) dh = 0;
  else if (Math.abs(h2 - h1) <= 180) dh = h2 - h1;
  else if (h2 - h1 > 180) dh = h2 - h1 - 360;
  else dh = h2 - h1 + 360;

  const dL = l2 - l1;
  const dC = c2p - c1p;
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh / 2) * RAD);
  const lBar = (l1 + l2) / 2;
  const cBarp = (c1p + c2p) / 2;

  let hBar: number;
  if (c1p * c2p === 0) hBar = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) hBar = (h1 + h2) / 2;
  else if (h1 + h2 < 360) hBar = (h1 + h2 + 360) / 2;
  else hBar = (h1 + h2 - 360) / 2;

  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * RAD) +
    0.24 * Math.cos(2 * hBar * RAD) +
    0.32 * Math.cos((3 * hBar + 6) * RAD) -
    0.2 * Math.cos((4 * hBar - 63) * RAD);
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const cBarp7 = cBarp ** 7;
  const rc = 2 * Math.sqrt(cBarp7 / (cBarp7 + POW7_25));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cBarp;
  const sh = 1 + 0.015 * cBarp * t;
  const rt = -Math.sin(2 * dTheta * RAD) * rc;
  const dl = dL / sl;
  const dc = dC / sc;
  const dhTerm = dH / sh;
  return Math.sqrt(dl * dl + dc * dc + dhTerm * dhTerm + rt * dc * dhTerm);
}

export interface DeltaESummary {
  readonly mean: number;
  readonly p95: number;
}

/**
 * Mean and 95th percentile of per-pixel CIEDE2000. Both buffers are packed
 * full-range BT.709 R′G′B′ in 0–1, the same length, one pixel after another.
 */
export function meanDeltaE(rgbA: ArrayLike<number>, rgbB: ArrayLike<number>): DeltaESummary {
  if (rgbA.length !== rgbB.length || rgbA.length === 0 || rgbA.length % 3 !== 0) {
    throw new RangeError('meanDeltaE expects equal, non-empty packed RGB');
  }
  const deltas: number[] = [];
  let sum = 0;
  for (let i = 0; i < rgbA.length; i += 3) {
    const a: Rgb = [rgbA[i] ?? 0, rgbA[i + 1] ?? 0, rgbA[i + 2] ?? 0];
    const b: Rgb = [rgbB[i] ?? 0, rgbB[i + 1] ?? 0, rgbB[i + 2] ?? 0];
    const delta = ciede2000(bt709ToCieLab(a), bt709ToCieLab(b));
    deltas.push(delta);
    sum += delta;
  }
  deltas.sort((x, y) => x - y);
  return { mean: sum / deltas.length, p95: percentile(deltas, 0.95) };
}
