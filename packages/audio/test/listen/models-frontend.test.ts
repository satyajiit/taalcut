// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F4: the two spectrogram front ends. The f64 oracles against upstream's feature extractors (the parity
 * fixtures), the ONNX graphs against the oracles on every execution provider that opens here, and the 48 → 16 kHz
 * resampler against soxr. No model needed.
 *
 * The graph is float32: about 140 dB of dynamic range, so a mel bin near the 1e-10 floor under a loud frame can be a
 * few hundredths of a dB off the f64 oracle whatever the DFT's shape or device. The gate of 1e-4 is on what carries
 * the sound: bins within 40 dB of the window's loudest (CLAP dB; AST's normalised log, where 40 dB is about 1.0).
 */
import { describe, expect, it } from 'vitest';
import { blob, intermediate } from '../../../../tools/earshot-parity/fixtures.mjs';
import { astFbankOracle, astFrameCount } from '../../src/listen/models/ast-fbank.oracle';
import { AST_FRONT_END } from '../../src/listen/models/ast-fbank';
import { clapInputWaveform, clapLogMelOracle } from '../../src/listen/models/clap-frontend.oracle';
import { CLAP_FRONT_END } from '../../src/listen/models/clap-frontend';
import { astMelBank, clapMelBank } from '../../src/listen/models/mel-banks';
import { resample48kTo16k } from '../../src/listen/models/resample';
import { clapSpans, spanSamples } from '../../src/listen/models/windows';
import { maxAbsNearPeak, modelMono, runGraphOn } from './models-helpers';

/** One AST normalised unit is 2·std nepers: 40 dB = ln(10⁴) / 9.14. */
const AST_40_DB = Math.log(1e4) / (2 * 4.5689974);

function chirp(seconds: number, seed: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * 48_000));
  let state = seed;
  for (let i = 0; i < out.length; i++) {
    const t = i / 48_000;
    state = (state * 1103515245 + 12345) % 2 ** 31;
    const noise = (state / 2 ** 31 - 0.5) * 0.02;
    out[i] =
      0.4 * Math.sin(2 * Math.PI * (200 * t + 900 * t * t)) + 0.2 * Math.sin(2 * Math.PI * 3100 * t) + noise;
  }
  return out;
}

describe('CLAP front end', () => {
  const features = intermediate<Record<string, { clip: string; span: [number, number] }>>('clap-features');

  it('repeat-pads like the extractor: whole tiles, zeros to 10 s', () => {
    const wave = clapInputWaveform(Float32Array.from({ length: 300_000 }, (_, i) => (i % 7) + 1));
    expect(wave[299_999]).toBe(((299_999 % 7) + 1) as number);
    expect(wave[300_000]).toBe(0);
    const short = clapInputWaveform(new Float32Array([1, 2]));
    expect(short[0]).toBe(1);
    expect(short[480]).toBe(1);
    expect(short[479]).toBe(0);
  });

  it('the Slaney bank: 513 × 64, every filter non-empty, nothing above 14 kHz', () => {
    const bank = clapMelBank();
    expect(bank.length).toBe(513 * 64);
    for (let m = 0; m < 64; m++) {
      let sum = 0;
      for (let k = 0; k < 513; k++) sum += bank[k * 64 + m] ?? 0;
      expect(sum).toBeGreaterThan(0);
    }
    for (let k = Math.ceil(14_000 / (24_000 / 512)); k < 513; k++) expect(bank[k * 64 + 63]).toBe(0);
  });

  it.each(Object.entries(features))('the oracle matches upstream within 1e-3 dB: %s', (key, row) => {
    const segment = spanSamples(modelMono(row.clip), row.span);
    const ours = clapLogMelOracle(segment);
    const theirs = blob(`clap-features/${key}`).data;
    const diff = maxAbsNearPeak(ours, theirs);
    console.warn(`CLAP oracle vs upstream, ${key}: max |Δ| ${diff.toExponential(2)} dB`);
    expect(diff).toBeLessThan(1e-3);
  });

  for (const provider of ['cpu', 'webgpu'] as const)
    it(`the graph matches the oracle on ${provider}`, async (context) => {
      const segments = [
        ...Object.values(features).map((row) => spanSamples(modelMono(row.clip), row.span)),
        spanSamples(modelMono('film-00'), clapSpans(0, 40)[2] ?? [0, 10]),
        chirp(3.2, 7),
        chirp(0.004, 3),
      ];
      const graph = await runGraphOn(CLAP_FRONT_END, segments, provider);
      if (!graph) {
        context.skip(`no ${provider} session here`);
        return;
      }
      segments.forEach((segment, i) => {
        const oracle = clapLogMelOracle(segment);
        const near = maxAbsNearPeak(graph[i] ?? new Float32Array(), oracle, 40);
        const all = maxAbsNearPeak(graph[i] ?? new Float32Array(), oracle);
        console.warn(
          `CLAP graph (${provider}) vs oracle #${i}: ${near.toExponential(2)} dB within 40 dB, ${all.toExponential(2)} dB all`,
        );
        expect(near).toBeLessThan(1e-4);
        expect(all).toBeLessThan(0.1);
      });
    }, 120_000);
});

describe('AST front end', () => {
  it('frames: 1 + ⌊(n − 400) / 160⌋, at least 0.1 s', () => {
    expect(astFrameCount(163_840)).toBe(1022);
    expect(astFrameCount(10)).toBe(8);
  });

  it('the Kaldi bank: 257 × 128, triangles in mel space up to 8 kHz', () => {
    const bank = astMelBank();
    expect(bank.length).toBe(257 * 128);
    expect(bank[0]).toBe(0);
    expect(Math.max(...bank)).toBeLessThanOrEqual(1);
  });

  it("the oracle matches upstream's fbank within 1e-3 from upstream's 16 kHz", () => {
    const y16 = blob('ast-resample-16k/sfx-whoosh-fast-crisp').data;
    const theirs = blob('ast-fbank/sfx-whoosh-fast-crisp');
    const ours = astFbankOracle(y16).subarray(0, theirs.data.length);
    const diff = maxAbsNearPeak(ours, theirs.data);
    console.warn(`AST oracle vs upstream: max |Δ| ${diff.toExponential(2)}`);
    expect(diff).toBeLessThan(1e-3);
  });

  it('through our resampler (not soxr) the fbank stays within 0.05 (0.4 dB) of upstream', () => {
    for (const id of ['sfx-whoosh-fast-crisp', 'speech-01']) {
      const theirs = blob(`ast-fbank/${id}`);
      const y16 = resample48kTo16k(modelMono(id)).subarray(0, 163_840);
      const ours = astFbankOracle(y16).subarray(0, theirs.data.length);
      const near = maxAbsNearPeak(ours, theirs.data, AST_40_DB);
      console.warn(`AST fbank through our resampler, ${id}: ${near.toExponential(2)} within 40 dB`);
      expect(near).toBeLessThan(0.05);
    }
  });

  for (const provider of ['cpu', 'webgpu'] as const)
    it(`the graph matches the oracle on ${provider}`, async (context) => {
      const segments = [
        blob('ast-resample-16k/sfx-whoosh-fast-crisp').data,
        resample48kTo16k(modelMono('speech-01')),
        resample48kTo16k(modelMono('edge-dc-offset')),
        resample48kTo16k(modelMono('film-00')).subarray(0, 163_840),
        new Float32Array(900).fill(0.25),
      ];
      const graph = await runGraphOn(AST_FRONT_END, segments, provider);
      if (!graph) {
        context.skip(`no ${provider} session here`);
        return;
      }
      segments.forEach((segment, i) => {
        const oracle = astFbankOracle(segment);
        const near = maxAbsNearPeak(graph[i] ?? new Float32Array(), oracle, AST_40_DB);
        const all = maxAbsNearPeak(graph[i] ?? new Float32Array(), oracle);
        console.warn(
          `AST graph (${provider}) vs oracle #${i}: ${near.toExponential(2)} within 40 dB, ${all.toExponential(2)} all`,
        );
        expect(near).toBeLessThan(1e-4);
        expect(all).toBeLessThan(1e-2);
      });
    }, 120_000);
});

describe('48 → 16 kHz', () => {
  it('lands within 0.2% RMS of soxr HQ, same length, no delay', () => {
    const theirs = blob('ast-resample-16k/sfx-whoosh-fast-crisp').data;
    const ours = resample48kTo16k(modelMono('sfx-whoosh-fast-crisp'));
    expect(ours.length).toBe(theirs.length);
    let err = 0;
    let sig = 0;
    for (let i = 0; i < ours.length; i++) {
      err += ((ours[i] ?? 0) - (theirs[i] ?? 0)) ** 2;
      sig += (theirs[i] ?? 0) ** 2;
    }
    const rel = Math.sqrt(err / sig);
    console.warn(`resampler vs soxr HQ: ${(rel * 100).toFixed(3)}% RMS`);
    expect(rel).toBeLessThan(2e-3);
  });

  it('gives round(n / 3) samples', () => {
    expect(resample48kTo16k(new Float32Array(48_001)).length).toBe(16_000);
    expect(resample48kTo16k(new Float32Array(48_002)).length).toBe(16_001);
  });
});
