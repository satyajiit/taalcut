// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-D3's acceptance for edits without Python: a take with duration ×0.5, +2 semitones and −3 dB passes the audit
 * (F6's `auditSound`) with its sample peak within ±0.5 dB of −3 dBFS, lands exactly at half its length, and sounds
 * 2 semitones up. On a synthetic struck tone always, and on pitched bank sounds where the bank has been built.
 * Stretched ('param') and faded ('trim') lengths both. Also earshot's own fit_length and the apex aim. (Half of a
 * 0.15 s knock is cut while it still rings, `truncated`, as earshot's own trim of it would be.)
 */
import { afterAll, describe, expect, it } from 'vitest';
import { auditSound } from '../src/listen/dsp/audit';
import { createSpectrogramRunner } from '../src/listen/dsp/spectrogram-graph';
import { apexSeconds } from '../src/sfx/bank-apex';
import { aimApex, applyEdits, fitLength, meanOf, samplePeak, SR } from '../src/sfx/kits/edits';
import { renderTake } from '../src/sfx/kits/render-take';
import { createSignalsmithStretcher, loadSignalsmithModule } from '../src/stretch/signalsmith';
import { testMedia } from './helpers/ffmpeg';
import { HAS_BANK, installedBank } from './sfx-bank-helpers';

const module = await loadSignalsmithModule();
if (!module.ok) throw new Error(module.error.code);
const stretcher = createSignalsmithStretcher(module.value);
const runner = createSpectrogramRunner();
afterAll(() => runner.release());

/** A struck tone: 660 Hz and its octave, a 3 ms attack, decaying over a second, slightly wide. */
function struck(seconds = 1, f0 = 660): Float32Array[] {
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.003) * Math.exp(-t * 5);
    const fade = i > n - 480 ? (n - i) / 480 : 1;
    const v = env * fade * (0.6 * Math.sin(2 * Math.PI * f0 * t) + 0.25 * Math.sin(4 * Math.PI * f0 * t));
    l[i] = v;
    r[i] = v * 0.97;
  }
  return [l, r];
}

/** The strongest frequency between `lo` and `hi` Hz over the first 200 ms (a plain DFT scan, 1 Hz steps). */
function strongestHz(mono: Float64Array, lo: number, hi: number): number {
  const n = Math.min(mono.length, Math.round(0.2 * SR));
  let best = 0;
  let at = lo;
  for (let f = lo; f <= hi; f += 1) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      re += (mono[i] ?? 0) * w * Math.cos((2 * Math.PI * f * i) / SR);
      im -= (mono[i] ?? 0) * w * Math.sin((2 * Math.PI * f * i) / SR);
    }
    if (re * re + im * im > best) {
      best = re * re + im * im;
      at = f;
    }
  }
  return at;
}

const peakDb = (channels: readonly Float32Array[]) => 20 * Math.log10(samplePeak(channels));

describe('kit edits as signal processing (EAR1-D3)', () => {
  it('fits a length as earshot does: a quarter fade, or silence padded', () => {
    const tone = struck(1);
    const cut = fitLength(tone, 0.5);
    expect(cut[0]?.length).toBe(24_000);
    expect(Math.abs(cut[0]?.[23_999] ?? 1)).toBe(0);
    expect(Math.abs(cut[0]?.[24_000 - 6_000 - 10] ?? 0)).toBeGreaterThan(0);
    const padded = fitLength(tone, 1.2);
    expect(padded[0]?.length).toBe(57_600);
    expect(Math.abs(padded[0]?.[57_000] ?? 1)).toBe(0);
  });

  it('moves the loudest 5 ms onto the target', () => {
    const tone = struck(1);
    const later = aimApex(tone, 0.25);
    expect(apexSeconds(meanOf(later))).toBeCloseTo(0.25, 3);
  });

  it('dur ×0.5, +2 semitones, −3 dB on a struck tone: clean, peak within 0.5 dB, 2 semitones up', async () => {
    const tone = struck(1);
    for (const durMethod of ['param', 'trim'] as const) {
      const made = await applyEdits(stretcher, tone, { dur: 0.5, semitones: 2, peakDb: -3, durMethod });
      if (!made.ok) throw new Error(made.error.code);
      expect(made.value[0]?.length, durMethod).toBe(24_000);
      expect(Math.abs(peakDb(made.value) + 3), durMethod).toBeLessThanOrEqual(0.5);
      const audit = await auditSound({ sampleRate: SR, channels: made.value }, runner, {
        category: 'notify',
      });
      expect(
        audit.warnings.map((w) => w.code),
        durMethod,
      ).toEqual([]);
      const heard = strongestHz(meanOf(made.value), 600, 800);
      expect(12 * Math.log2(heard / 660), durMethod).toBeCloseTo(2, 1);
    }
  });
});

const found = await testMedia('sfx kit edits');

describe.skipIf(!HAS_BANK || !found.ctx)('edited bank takes (EAR1-D3)', () => {
  it(
    'dur ×0.5, +2 semitones, −3 dB on pitched bank sounds: clean, peak within 0.5 dB',
    { timeout: 300_000 },
    async () => {
      const media = found.ctx;
      if (!media) return;
      const bank = await installedBank();
      const sounds = ['pluck/kalimba', 'notify/m0', 'mallet/glock', 'pro_notify/ding_1822', 'ui_pop/soft'];
      for (const sound of sounds) {
        const item = bank.byUpstreamId(sound);
        const take = item?.takes[0];
        if (!item || !take || !item.knobs.pitch) throw new Error(`${sound} has no pitch knob`);
        const target = item.knobs.pitch.nativeHz * 2 ** (2 / 12);
        const made = await renderTake(
          { bank, media, runner, stretcher },
          {
            role: 'bell',
            file: 'bell_1.wav',
            sound,
            seed: item.seed,
            pitch: target,
            edits: { dur: take.durationMs / 2000, peak_db: -3 },
            maxS: null,
            k: 1,
          },
        );
        if (!made.ok) throw new Error(`${sound}: ${made.error.detail ?? made.error.code}`);
        expect(made.value.source, sound).toBe('edited');
        expect(
          made.value.audit.warnings.map((w) => w.code),
          sound,
        ).toEqual([]);
        expect(Math.abs(peakDb(made.value.channels) + 3), sound).toBeLessThanOrEqual(0.5);
        expect(made.value.channels[0]?.length, sound).toBe(Math.round((take.durationMs / 2000) * SR));
      }
    },
  );
});
