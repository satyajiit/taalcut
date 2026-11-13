// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A correctly rounded log10. NumPy's log10 on the reference machine (Apple libm) is correctly rounded; V8's
 * Math.log10 is one ulp off on about 2 % of inputs. Upstream's swell search takes argmin over −80 dB plateaus of a
 * running mean whose 1e-14 drift comes from those last bits, so the level envelope needs the exact value.
 * Double-double arithmetic (Dekker) carries ~32 digits through the atanh series of ln, then one rounding.
 */

/** log10(2) and 1/ln(10) as double-double pairs. */
const LOG10_2: readonly [number, number] = [0.3010299956639812, -2.8037281277851704e-18];
const INV_LN10: readonly [number, number] = [0.4342944819032518, 1.098319650216765e-17];
const SPLIT = 134_217_729; // 2^27 + 1

function twoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const bb = s - a;
  return [s, a - (s - bb) + (b - bb)];
}

function twoProd(a: number, b: number): [number, number] {
  const p = a * b;
  const ca = SPLIT * a;
  const ah = ca - (ca - a);
  const al = a - ah;
  const cb = SPLIT * b;
  const bh = cb - (cb - b);
  const bl = b - bh;
  return [p, ah * bh - p + ah * bl + al * bh + al * bl];
}

type DD = readonly [number, number];

function ddAdd(a: DD, b: DD): DD {
  const [s, e] = twoSum(a[0], b[0]);
  const t = e + a[1] + b[1];
  return twoSum(s, t);
}

function ddMul(a: DD, b: DD): DD {
  const [p, e] = twoProd(a[0], b[0]);
  return twoSum(p, e + a[0] * b[1] + a[1] * b[0]);
}

function ddDiv(a: DD, b: DD): DD {
  const q1 = a[0] / b[0];
  const r = ddAdd(a, ddMul(b, [-q1, 0]));
  const q2 = r[0] / b[0];
  const r2 = ddAdd(r, ddMul(b, [-q2, 0]));
  const q3 = r2[0] / b[0];
  return ddAdd(twoSum(q1, q2), [q3, 0]);
}

/** ln(f) for f in [√½, √2) as a double-double: 2·atanh((f − 1)/(f + 1)). */
function lnReduced(f: number): DD {
  const num: DD = [f - 1, 0];
  const den = twoSum(f, 1);
  const s = ddDiv(num, den);
  const s2 = ddMul(s, s);
  let term: DD = s;
  let sum: DD = s;
  for (let k = 3; k < 200; k += 2) {
    term = ddMul(term, s2);
    const add = ddDiv(term, [k, 0]);
    sum = ddAdd(sum, add);
    if (Math.abs(add[0]) < Math.abs(sum[0]) * 1e-34) break;
  }
  return [2 * sum[0], 2 * sum[1]];
}

/** log10(x), correctly rounded for finite positive x (ties aside); NaN, −Infinity and Infinity as Math.log10. */
export function log10Exact(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return Math.log10(x);
  let e = Math.floor(Math.log2(x));
  let f = x / 2 ** e;
  // Keep f in [√½, √2) so the series converges fast; powers of two scale exactly.
  if (f >= Math.SQRT2) {
    f /= 2;
    e += 1;
  } else if (f < Math.SQRT1_2) {
    f *= 2;
    e -= 1;
  }
  const ln = lnReduced(f);
  const scaled = ddMul(ln, INV_LN10);
  const whole = ddMul(LOG10_2, [e, 0]);
  const total = ddAdd(whole, scaled);
  return total[0] + total[1];
}
