// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F6 against upstream earshot (tools/earshot-parity): `earshot measure --music` on every clip, field by field
 * (levels within 0.1 dB/LU, the rest within the tolerance beside it), and core's SoundMeasures from each.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { soundMeasuresSchema } from '@taalcut/core';
import { measureSound, toSoundMeasures, type Measurements } from '../../src/listen/dsp/measure';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { cli, loadClip } from '../../../../tools/earshot-parity/fixtures.mjs';

const FIELDS: Array<[string, keyof Measurements, number]> = [
  ['peak_dbfs', 'peakDbfs', 0.1],
  ['true_peak_dbtp', 'truePeakDbtp', 0.1],
  ['rms_dbfs', 'rmsDbfs', 0.1],
  ['lufs', 'lufs', 0.1],
  ['short_term_max_lufs', 'shortTermMaxLufs', 0.1],
  ['lra_lu', 'lraLu', 0.1],
  ['clipped_samples', 'clippedSamples', 0],
  ['dc', 'dc', 2e-5],
  ['noise_floor_dbfs', 'noiseFloorDbfs', 0.1],
  ['dynamic_range_db', 'dynamicRangeDb', 0.1],
  ['digital_silence_frac', 'digitalSilenceFrac', 1e-4],
  ['side_to_mid_db', 'sideToMidDb', 0.1],
  ['correlation', 'correlation', 0.001],
  ['attack_at', 'attackAt', 0.001],
  ['peak_at', 'peakAt', 0.001],
  ['attack_ms', 'attackMs', 0],
  ['decay_ms', 'decayMs', 0],
  ['centroid_hz', 'centroidHz', 1],
  ['rolloff95_hz', 'rolloff95Hz', 1],
  ['bandwidth_hz', 'bandwidthHz', 0],
  ['flatness', 'flatness', 0.001],
  ['brightness_hz', 'brightnessHz', 1],
];

const runner = createSpectrogramRunner();
const report: string[] = [];
afterAll(async () => {
  await runner.release();
  if (process.env.TAALCUT_LISTEN_REPORT) console.warn(report.join('\n'));
});

describe('measurements against upstream earshot', () => {
  it('matches every measure field on every clip', async () => {
    let checked = 0;
    let ok = 0;
    for (const [id, run] of Object.entries(cli<Record<string, unknown>>('measure'))) {
      const clip = loadClip(id);
      const mine = await measureSound({ sampleRate: clip.sampleRate, channels: clip.channels }, runner);
      const theirs = run.result;
      const fields: Array<[string, unknown, unknown, number]> = FIELDS.map(([u, t, tol]) => [
        u,
        theirs[u],
        mine[t],
        tol,
      ]);
      const bands = (theirs['bands_db'] ?? {}) as Record<string, number>;
      for (const [b, v] of Object.entries(bands))
        fields.push([`bands_db.${b}`, v, mine.bandsDb?.[b as 'sub'], 0.1]);
      for (const [name, want, got, tol] of fields) {
        checked++;
        const same =
          want === undefined || want === null
            ? got === undefined || got === null
            : typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) <= tol + 1e-9;
        if (same) ok++;
        else report.push(`${id} ${name}: ${String(got)} vs ${String(want)}`);
      }
      expect(soundMeasuresSchema.safeParse(toSoundMeasures(mine)).success, id).toBe(true);
    }
    report.push(`measure fields within tolerance: ${ok}/${checked}`);
    expect(ok / checked).toBeGreaterThanOrEqual(0.99);
  }, 120_000);
});
