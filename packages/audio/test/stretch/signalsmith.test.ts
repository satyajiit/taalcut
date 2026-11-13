// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { createSignalsmithStretcher, loadSignalsmithModule } from '../../src/stretch/signalsmith';
import type { Pcm } from '../../src/pcm/pcm';

const RATE = 48_000;

/** Short decaying 2 kHz bursts at `times` (seconds): each one's peak is at its start. */
function clicks(times: readonly number[], seconds: number, channels = 1): Pcm {
  const data = new Float32Array(Math.round(seconds * RATE));
  for (const t of times) {
    const start = Math.round(t * RATE);
    for (let i = 0; i < 480 && start + i < data.length; i++)
      data[start + i] = Math.sin((2 * Math.PI * 2000 * i) / RATE) * Math.exp(-i / 60);
  }
  return { sampleRate: RATE, channels: Array.from({ length: channels }, () => data.slice()) };
}

/** Onsets: the first sample of each burst of energy above a threshold, 0.2 s apart at least. */
function onsets(signal: Float32Array): number[] {
  const found: number[] = [];
  const hop = 48;
  let last = -Infinity;
  for (let i = 0; i + hop <= signal.length; i += hop) {
    let energy = 0;
    for (let j = 0; j < hop; j++) energy += (signal[i + j] ?? 0) ** 2;
    if (energy / hop > 0.01 && i - last > 0.2 * RATE) {
      found.push(i);
      last = i;
    }
  }
  return found;
}

describe('Signalsmith stretcher', () => {
  it('keeps the output exactly as long as the targets and lands clicks within 2 ms of their mapped times', async () => {
    const module = await loadSignalsmithModule();
    expect(module.ok).toBe(true);
    if (!module.ok) return;
    const stretcher = createSignalsmithStretcher(module.value);
    const input = clicks([0.5, 1, 1.5, 2, 2.5, 3, 3.5], 4);
    // Two bars: the first 1.1× longer, the second 0.9×.
    const segments = [
      { sourceStart: 0, sourceEnd: 2 * RATE, targetLength: Math.round(2.2 * RATE) },
      { sourceStart: 2 * RATE, sourceEnd: 4 * RATE, targetLength: Math.round(1.8 * RATE) },
    ];
    const out = await stretcher.stretch(input, segments);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const channel = out.value.channels[0] ?? new Float32Array();
    expect(channel.length).toBe(Math.round(4 * RATE));
    const mapped = [0.55, 1.1, 1.65, 2.2, 2.65, 3.1, 3.55].map((t) => Math.round(t * RATE));
    const found = onsets(channel);
    expect(found).toHaveLength(mapped.length);
    found.forEach((sample, i) =>
      expect(Math.abs(sample - (mapped[i] ?? 0))).toBeLessThanOrEqual(0.002 * RATE),
    );
  });
});
