// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * In-memory mono loudness estimator using BS.1770 K-weighting and gating; not a certified EBU R128 meter.
 * Runs directly on `Float32Array` PCM buffers with zero process spawns:
 * 1. Two-stage K-weighting biquad cascade (Stage 1: head-acoustics high-shelf; Stage 2: RLB high-pass).
 * 2. 400 ms gating blocks with 75% overlap (100 ms stride), `-70 LKFS` absolute gate and `-10 LU` relative gate.
 * 3. Four-times FIR reconstructed peak, momentary/short-term maxima and a block-based LRA estimate.
 * 4. `solveStemLoudnorm` & `normalisePcmToLufs`: computes headroom-safe gain and soft-knee peak limiting per role.
 */
import { STEM_LOUDNESS_TARGETS, type StemLoudnessReport, type StemLoudnessRole } from '@taalcut/core';
import { reconstructedPeak } from './true-peak';

export interface Bs1770Measurement {
  readonly integratedLufs: number;
  readonly truePeakDbtp: number;
  readonly loudnessRangeLu: number;
  readonly momentaryMaxLufs: number;
  readonly shortTermMaxLufs: number;
}

const SILENCE_LUFS = -70;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface BiquadCoeffs {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/**
 * Computes ITU-R BS.1770-4 K-weighting biquad filter coefficients for an arbitrary `sampleRate`
 * (matching the standard 48 kHz coefficients and bilinear-warped equivalents for other rates).
 */
function kWeightingFilters(sampleRate: number): readonly [BiquadCoeffs, BiquadCoeffs] {
  if (sampleRate === 48_000) {
    return [
      // Stage 1: High-shelf pre-filter (+4 dB above ~1.5 kHz)
      {
        b0: 1.53512485958697,
        b1: -2.69169618940638,
        b2: 1.19839281085285,
        a1: -1.69065929318241,
        a2: 0.73248077421585,
      },
      // Stage 2: RLB high-pass filter (~38 Hz)
      {
        b0: 1.0,
        b1: -2.0,
        b2: 1.0,
        a1: -1.99004745483398,
        a2: 0.99007225036621,
      },
    ];
  }
  // Bilinear transform design for arbitrary sampleRate (mirrors pyloudnorm's IIRfilter design).
  const f0Shelf = 1681.974450955533;
  const gShelf = 3.999843853973347;
  const qShelf = 0.7071752369554196;
  const kShelf = Math.tan((Math.PI * f0Shelf) / sampleRate);
  const vh = Math.pow(10, gShelf / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0s = 1 + kShelf / qShelf + kShelf * kShelf;
  const stage1: BiquadCoeffs = {
    b0: (vh + (vb * kShelf) / qShelf + kShelf * kShelf) / a0s,
    b1: (2 * (kShelf * kShelf - vh)) / a0s,
    b2: (vh - (vb * kShelf) / qShelf + kShelf * kShelf) / a0s,
    a1: (2 * (kShelf * kShelf - 1)) / a0s,
    a2: (1 - kShelf / qShelf + kShelf * kShelf) / a0s,
  };

  const f0Hp = 38.13547087602444;
  const qHp = 0.5003270373238773;
  const kHp = Math.tan((Math.PI * f0Hp) / sampleRate);
  const a0h = 1 + kHp / qHp + kHp * kHp;
  const stage2: BiquadCoeffs = {
    b0: 1 / a0h,
    b1: -2 / a0h,
    b2: 1 / a0h,
    a1: (2 * (kHp * kHp - 1)) / a0h,
    a2: (1 - kHp / qHp + kHp * kHp) / a0h,
  };
  return [stage1, stage2];
}

function applyBiquad(input: Float32Array, c: BiquadCoeffs): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i] ?? 0;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

const energyToLufs = (meanSquare: number): number =>
  meanSquare <= 1e-12 ? SILENCE_LUFS : Math.max(SILENCE_LUFS, -0.691 + 10 * Math.log10(meanSquare));

/**
 * Estimates integrated loudness, true peak, LRA, and momentary/short-term maxima on mono PCM.
 * True peak uses 4× interpolation (192 kHz at the default 48 kHz input rate).
 */
export function measureBs1770Loudness(samples: Float32Array, sampleRate = 48_000): Bs1770Measurement {
  if (samples.length === 0) {
    return {
      integratedLufs: SILENCE_LUFS,
      truePeakDbtp: -100,
      loudnessRangeLu: 0,
      momentaryMaxLufs: SILENCE_LUFS,
      shortTermMaxLufs: SILENCE_LUFS,
    };
  }

  const maxPeak = reconstructedPeak(samples);
  const truePeakDbtp = maxPeak <= 1e-6 ? -100 : r2(20 * Math.log10(maxPeak));

  const [stage1, stage2] = kWeightingFilters(sampleRate);
  const kw = applyBiquad(applyBiquad(samples, stage1), stage2);

  // 100 ms sub-blocks (4 sub-blocks = 400 ms gating block; 30 sub-blocks = 3.0 s short-term block).
  const hopSamples = Math.max(1, Math.round(sampleRate * 0.1));
  const subBlockCount = Math.max(1, Math.ceil(kw.length / hopSamples));
  const subEnergies = new Float64Array(subBlockCount);
  for (let b = 0; b < subBlockCount; b++) {
    const start = b * hopSamples;
    const end = Math.min(kw.length, start + hopSamples);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const v = kw[i] ?? 0;
      sumSq += v * v;
    }
    subEnergies[b] = sumSq / Math.max(1, end - start);
  }

  // Momentary blocks (400 ms = 4 hops, or whole signal if shorter than 400 ms).
  const blockCount = subBlockCount >= 4 ? subBlockCount - 3 : 1;
  const blockEnergies: number[] = [];
  let momentaryMaxLufs = SILENCE_LUFS;
  for (let i = 0; i < blockCount; i++) {
    const span = Math.min(4, subBlockCount - i);
    let sum = 0;
    for (let k = 0; k < span; k++) sum += subEnergies[i + k] ?? 0;
    const meanSq = sum / span;
    blockEnergies.push(meanSq);
    const lufs = energyToLufs(meanSq);
    if (lufs > momentaryMaxLufs) momentaryMaxLufs = lufs;
  }

  // Short-term max (3.0 s = 30 hops, or available hops).
  const stCount = subBlockCount >= 30 ? subBlockCount - 29 : 1;
  let shortTermMaxLufs = SILENCE_LUFS;
  for (let i = 0; i < stCount; i++) {
    const span = Math.min(30, subBlockCount - i);
    let sum = 0;
    for (let k = 0; k < span; k++) sum += subEnergies[i + k] ?? 0;
    const lufs = energyToLufs(sum / span);
    if (lufs > shortTermMaxLufs) shortTermMaxLufs = lufs;
  }

  // Absolute gate (-70 LKFS) -> energy threshold = 10^((-70 + 0.691) / 10).
  const absGateEnergy = Math.pow(10, (-70 + 0.691) / 10);
  const aboveAbs = blockEnergies.filter((e) => e > absGateEnergy);
  if (aboveAbs.length === 0) {
    return {
      integratedLufs: SILENCE_LUFS,
      truePeakDbtp,
      loudnessRangeLu: 0,
      momentaryMaxLufs: r2(momentaryMaxLufs),
      shortTermMaxLufs: r2(shortTermMaxLufs),
    };
  }
  const absMeanEnergy = aboveAbs.reduce((a, b) => a + b, 0) / aboveAbs.length;
  const relGateLufs = energyToLufs(absMeanEnergy) - 10;
  const relGateEnergy = Math.pow(10, (relGateLufs + 0.691) / 10);
  const aboveRel = aboveAbs.filter((e) => e > relGateEnergy);
  const finalBlocks = aboveRel.length > 0 ? aboveRel : aboveAbs;
  const integratedEnergy = finalBlocks.reduce((a, b) => a + b, 0) / finalBlocks.length;
  const integratedLufs = r2(energyToLufs(integratedEnergy));

  // Loudness Range (LRA): 10th to 95th percentile of gated block LUFS values.
  const sortedLufs = finalBlocks.map(energyToLufs).sort((a, b) => a - b);
  const p10 = sortedLufs[Math.floor((sortedLufs.length - 1) * 0.1)] ?? integratedLufs;
  const p95 = sortedLufs[Math.floor((sortedLufs.length - 1) * 0.95)] ?? integratedLufs;
  const loudnessRangeLu = r2(Math.max(0, p95 - p10));

  return {
    integratedLufs,
    truePeakDbtp,
    loudnessRangeLu,
    momentaryMaxLufs: r2(momentaryMaxLufs),
    shortTermMaxLufs: r2(shortTermMaxLufs),
  };
}

/**
 * Solves for the headroom-safe stem gain (`recommendedGainDb`) and whether dynamic range compression
 * (`needsCompression`) is required to reach `STEM_LOUDNESS_TARGETS[role]`.
 */
export function solveStemLoudnorm(
  samples: Float32Array,
  sampleRate: number,
  role: StemLoudnessRole,
): StemLoudnessReport {
  const m = measureBs1770Loudness(samples, sampleRate);
  const target = STEM_LOUDNESS_TARGETS[role];
  if (m.integratedLufs <= SILENCE_LUFS + 0.5) {
    return {
      role,
      ...m,
      targetLufs: target.targetLufs,
      recommendedGainDb: 0,
      needsCompression: false,
    };
  }
  const rawDeltaDb = target.targetLufs - m.integratedLufs;
  const peakHeadroomDb = target.maxTruePeakDbtp - m.truePeakDbtp;
  const recommendedGainDb = r2(Math.max(-24, Math.min(24, Math.min(rawDeltaDb, peakHeadroomDb))));
  const needsCompression = m.loudnessRangeLu > target.maxLraLu || rawDeltaDb - peakHeadroomDb > 2.5;
  return {
    role,
    ...m,
    targetLufs: target.targetLufs,
    recommendedGainDb,
    needsCompression,
  };
}

/**
 * Applies loudness gain and a sample-domain soft knee, then attenuates any FIR-measured overshoot.
 * Peak protection can leave loudness below target; finite-resolution metering is not a codec guarantee.
 */
export function normalisePcmToLufs(
  samples: Float32Array,
  sampleRate = 48_000,
  targetLufs = -16,
  maxPeakDbtp = -1.0,
): Float32Array {
  const m = measureBs1770Loudness(samples, sampleRate);
  if (m.integratedLufs <= SILENCE_LUFS + 0.5) return new Float32Array(samples);
  const gainLinear = Math.pow(10, (targetLufs - m.integratedLufs) / 20);
  const ceiling = Math.pow(10, maxPeakDbtp / 20);
  const knee = ceiling * 0.85;
  const headroom = Math.max(1e-6, ceiling - knee);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const scaled = (samples[i] ?? 0) * gainLinear;
    const abs = Math.abs(scaled);
    if (abs <= knee) {
      out[i] = scaled;
    } else {
      const sign = scaled < 0 ? -1 : 1;
      out[i] = sign * (knee + headroom * Math.tanh((abs - knee) / headroom));
    }
  }
  const peak = reconstructedPeak(out);
  if (peak > ceiling) {
    const correction = ceiling / peak;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * correction;
  }
  return out;
}
