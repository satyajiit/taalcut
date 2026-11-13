// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Known answers on synthetic signals: hits at planted times, a swell, a click track's tempo, chords' keys, faults
 * the audit must name, and a tone's measurements. Runs on the CPU oracle (the graph is tested on its own).
 */
import { soundAuditReportSchema, soundMeasuresSchema } from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import { auditSound, toSoundAuditReport } from '../../src/listen/dsp/audit';
import { takeTimes } from '../../src/listen/dsp/audit-shape';
import { estimateKey } from '../../src/listen/dsp/key';
import { measureSound, toSoundMeasures } from '../../src/listen/dsp/measure';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { musicGrid } from '../../src/listen/dsp/tempo-grid';
import { analyseEvents, toSoundEvents } from '../../src/listen/timeline/events';
import { clickTrack, hit, hitsAt, mixAt, mono, noise, silence, SR, tone } from './dsp-signals';

const runner = createSpectrogramRunner({ plan: { devices: ['cpu'] } });
afterAll(() => runner.release());

/** A chord's notes (MIDI) as summed tones with a few partials, held `seconds`. */
function chords(progression: number[][], each: number): Float32Array {
  const out = silence(progression.length * each);
  progression.forEach((notes, k) => {
    for (const midi of notes) {
      const hz = 440 * 2 ** ((midi - 69) / 12);
      for (const [h, a] of [
        [1, 0.12],
        [2, 0.04],
        [3, 0.02],
      ] as const) {
        mixAt(out, tone(hz * h, each, a), k * each);
      }
    }
  });
  return out;
}

describe('events on synthetic signals', () => {
  it('finds planted hits within 2 ms of their attack, and no others', async () => {
    const times = [0.5, 1.13, 1.9, 2.4, 3.71];
    const { events } = await analyseEvents(mono(hitsAt(times, 4.5)), runner);
    const hits = events.filter((e) => e.shape === 'hit' && !e.startsFile);
    expect(hits).toHaveLength(times.length);
    hits.forEach((e, i) => expect(Math.abs(e.t - (times[i] ?? 0))).toBeLessThanOrEqual(0.002));
    expect(hits.every((e) => e.prominenceDb > 20)).toBe(true);
    expect(toSoundEvents(events)[1]?.exposed).toBe(true);
  });

  it('marks a file that starts with sound and finds a swell at its peak', async () => {
    // A 300 Hz tone swelling smoothly 42 dB over 1.5 s to its peak at 2.5 s, then down again in 0.4 s. Upstream
    // (timeline.detect_events on the same samples) puts the swell at 2.47 s with a 2 s rise.
    const x = tone(300, 4, 1);
    const ease = (v: number) => Math.sin((Math.PI / 2) * Math.min(1, Math.max(0, v))) ** 2;
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      const level = t < 2.5 ? -46 + 42 * ease((t - 1) / 1.5) : -4 - 42 * ease((t - 2.5) / 0.4);
      x[i] = (x[i] ?? 0) * 10 ** (level / 20);
    }
    mixAt(x, hit(0.3), 0);
    const { events } = await analyseEvents(mono(x), runner);
    expect(events[0]?.t).toBeLessThanOrEqual(0.002);
    const swell = events.find((e) => e.shape === 'swell');
    expect(swell?.t).toBe(2.47);
    expect(swell?.riseMs).toBe(2000);
  });

  it('returns nothing under 0.1 s', async () => {
    expect((await analyseEvents(mono(noise(0.05)), runner)).events).toEqual([]);
  });
});

describe('beat grid and key on synthetic music', () => {
  it('gives a 120 BPM click track 120 BPM with a clear pulse', async () => {
    const grid = await musicGrid(clickTrack(120, 12), runner);
    expect(Math.abs((grid.tempo ?? 0) - 120)).toBeLessThanOrEqual(1);
    expect(grid.confidence).toBe('clear');
    expect(grid.beats.length).toBeGreaterThan(20);
    expect((await musicGrid(clickTrack(120, 3), runner)).note).toBe('too short for a beat grid');
  });

  it('names C major and A minor progressions', async () => {
    const cMajor = await estimateKey(
      chords(
        [
          [60, 64, 67],
          [65, 69, 72],
          [67, 71, 74],
          [60, 64, 67],
        ],
        2,
      ),
      runner,
    );
    expect(`${cMajor[0]?.tonic} ${cMajor[0]?.mode}`).toBe('C major');
    const aMinor = await estimateKey(
      chords(
        [
          [57, 60, 64],
          [62, 65, 69],
          [64, 68, 71],
          [57, 60, 64],
        ],
        2,
      ),
      runner,
    );
    expect(`${aMinor[0]?.tonic} ${aMinor[0]?.mode}`).toBe('A minor');
  });
});

describe('the audit on synthetic faults', () => {
  const clean = () => {
    const x = hit(0.8, 4);
    const out = silence(0.4);
    mixAt(out, x, 0.01);
    return out;
  };
  const codes = async (x: Float32Array, context = {}) => {
    const a = await auditSound(mono(x), runner, context);
    expect(soundAuditReportSchema.safeParse(toSoundAuditReport(a)).success).toBe(true);
    return [...a.warnings.map((w) => w.code), ...a.notes.map((n) => `note:${n.code}`)];
  };

  it('passes a clean hit and names DC, clipping, clicks, silence and an edge', async () => {
    expect(await codes(clean())).toEqual([]);
    expect(await codes(clean().map((v) => v + 0.05))).toEqual(expect.arrayContaining(['dc', 'edge']));
    expect(await codes(clean().map((v) => Math.max(-0.5, Math.min(0.5, v * 3))))).toContain('clipping');
    const click = clean();
    click[Math.round(0.3 * SR)] = 0.3;
    expect(await codes(click)).toContain('clicks');
    expect(await codes(silence(0.3))).toContain('silent');
  });

  it('names a rising synth whip, and a stacked hit only for a hit role', async () => {
    const n = Math.round(0.3 * SR);
    const sweep = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const hz = 400 * 2 ** ((12 * i) / n / 12);
      phase += (2 * Math.PI * hz) / SR;
      sweep[i] = 0.5 * Math.sin(phase) * Math.sin((Math.PI * i) / n);
    }
    expect(await codes(sweep)).toContain('rising_glide');
    const two = silence(0.5);
    mixAt(two, hit(0.8, 5), 0.02);
    mixAt(two, hit(0.8, 6), 0.2);
    expect(await codes(two, { role: 'hit' })).toContain('stacked');
    expect(await codes(two)).not.toContain('stacked');
  });

  it('places a take’s onset, loudest 5 ms and end', () => {
    const x = silence(1);
    mixAt(x, hit(0.8, 7), 0.25);
    const m = Float64Array.from(x);
    const t = takeTimes(m);
    expect(Math.abs(t.onsetS - 0.25)).toBeLessThanOrEqual(0.002);
    expect(t.peakS).toBeGreaterThan(0.25);
    expect(t.peakS).toBeLessThan(0.27);
    expect(t.endS).toBeGreaterThan(t.peakS);
    expect(t.durS).toBe(1);
  });
});

describe('measurements', () => {
  it('measures a 2 kHz tone and gives core’s SoundMeasures', async () => {
    const r = await measureSound(mono(tone(2000, 7, 0.5)), runner, { music: true });
    expect(r.peakDbfs).toBeCloseTo(-6, 1);
    expect(r.bandsDb?.mid).toBeGreaterThan(-0.1);
    expect(r.sideToMidDb).toBeNull();
    expect(r.correlation).toBe(1);
    const core = soundMeasuresSchema.parse(toSoundMeasures(r));
    expect(core.duration).toEqual({ value: 7 * SR, rate: { num: SR, den: 1 } });
    expect(core.nearSilent).toBe(false);
    expect((await measureSound(mono(noise(0.001)), runner)).error).toBe('too short to measure');
  });
});
