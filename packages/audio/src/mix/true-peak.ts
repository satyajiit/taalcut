// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Four-phase, 12-tap FIR interpolator from ITU-R BS.1770-5 Annex 2, pp. 18–19:
 * https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf
 * Floating-point input needs no integer-headroom attenuation. This estimates reconstructed peaks;
 * finite oversampling and filter ripple still limit accuracy. It is not a meter compliance claim.
 */
const PHASES: readonly (readonly number[])[] = [
  [
    0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875, 0.1373291015625,
    0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125,
  ],
  [
    -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625,
    0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375,
  ],
  [
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625,
    0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875,
  ],
  [
    -0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875, 0.97216796875,
    0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375,
  ],
];

/** Mono PCM, with silence outside the buffer; retain sample peaks and flush the FIR tail. */
export function reconstructedPeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length + 11; i++) {
    peak = Math.max(peak, Math.abs(samples[i] ?? 0));
    for (const phase of PHASES) {
      let value = 0;
      for (let tap = 0; tap < phase.length; tap++) {
        value += (samples[i - tap] ?? 0) * phase[tap]!;
      }
      peak = Math.max(peak, Math.abs(value));
    }
  }
  return peak;
}
