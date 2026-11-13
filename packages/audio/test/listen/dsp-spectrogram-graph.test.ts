// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every listen spectrogram graph against its f64 oracle (EAR1-F6: < 1e-4). The graphs run through ONNX Runtime on
 * the CPU provider here, so CI checks the graph's math everywhere; on a machine whose WebGPU session opens, the same
 * graphs also run there. The measure is the largest difference over the largest value of the linear output (a dB
 * output is compared as power), so quiet cells' float32 rounding doesn't dominate.
 */
import type { ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { listenSpectrogramSpecs } from '../../src/listen/dsp/spectra';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { oracleSegmentPower, oracleSpectrogram } from '../../src/listen/dsp/spectrogram-oracle';
import { centredFrames, type SpectrogramSpec } from '../../src/listen/dsp/transforms';
import { noise, tone } from './dsp-signals';

function linear(spec: SpectrogramSpec, v: number): number {
  return spec.output === 'db' ? 10 ** (v / 10) : v;
}

function relativeError(spec: SpectrogramSpec, a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let top = 0;
  let worst = 0;
  for (let i = 0; i < a.length; i++) top = Math.max(top, Math.abs(linear(spec, b[i] ?? 0)));
  for (let i = 0; i < a.length; i++) {
    worst = Math.max(worst, Math.abs(linear(spec, a[i] ?? 0) - linear(spec, b[i] ?? 0)));
  }
  return worst / Math.max(top, 1e-30);
}

const signal = (() => {
  const t = tone(440, 1.5, 0.5);
  const n = noise(1.5, 0.05, 7);
  return t.map((v, i) => v + (n[i] ?? 0));
})();

const worstSeen: string[] = [];

describe('listen spectrogram graphs', () => {
  for (const devices of [['cpu'], ['webgpu']] as const) {
    it(`match the oracle within 1e-4 (${devices[0]})`, async () => {
      const runner = createSpectrogramRunner({
        plan: { devices: [...devices] },
        cpuGraph: devices[0] === 'cpu',
        chunkFrames: 128,
      });
      try {
        for (const spec of listenSpectrogramSpecs()) {
          const block = centredFrames(signal, spec.frameLength, Math.max(240, spec.frameLength / 4));
          const graph = await runner.spectrogram(spec, block);
          if (devices[0] === 'webgpu' && graph.backend !== 'webgpu') return;
          const oracle = oracleSpectrogram(spec, block);
          expect(graph.columns).toBe(oracle.columns);
          const error = relativeError(spec, graph.data, oracle.data);
          worstSeen.push(`${graph.backend} ${spec.id} ${error.toExponential(2)}`);
          expect(error, spec.id).toBeLessThan(1e-4);
        }
        const n = 65_536;
        const segments = new Float32Array(3 * n);
        for (let i = 0; i < segments.length; i++) segments[i] = signal[i % signal.length] ?? 0;
        const graph = await runner.segmentPower(segments, 3, n);
        const oracle = oracleSegmentPower(segments, 3, n);
        let top = 0;
        let worst = 0;
        for (let i = 0; i < oracle.length; i++) top = Math.max(top, oracle[i] ?? 0);
        for (let i = 0; i < oracle.length; i++)
          worst = Math.max(worst, Math.abs((graph.power[i] ?? 0) - (oracle[i] ?? 0)));
        worstSeen.push(`${graph.backend} four-step ${(worst / top).toExponential(2)}`);
        if (process.env.TAALCUT_LISTEN_REPORT) console.warn(worstSeen.join('\n'));
        expect(worst / top).toBeLessThan(1e-4);
      } finally {
        await runner.release();
      }
    });
  }

  it('logs one compute.fallback and uses the oracle when no accelerator opens', async () => {
    const events: ComputeFallbackEvent[] = [];
    const runner = createSpectrogramRunner({
      plan: {
        devices: ['cpu'],
        cpuReason: { reason: 'disabled', detail: 'TAALCUT_FORCE_CPU', wanted: ['webgpu'] },
      },
      onFallback: (event) => events.push(event),
    });
    const specs = listenSpectrogramSpecs();
    for (const spec of specs) {
      const out = await runner.spectrogram(
        spec,
        centredFrames(signal.subarray(0, 9600), spec.frameLength, 480),
      );
      expect(out.backend).toBe('cpu');
    }
    await runner.release();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ operation: 'listen.frontend', reason: 'disabled' });
  });
});
