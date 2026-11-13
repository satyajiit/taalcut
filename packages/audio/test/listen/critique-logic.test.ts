// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A1 critique rules on known answers: the profile (the bundled one rebuilt from its own films, leave-one-out,
 * a template reel's), the scorecard (web windows, the near miss, realness weights, the density floor, decoded lossy
 * true peak, verdict bands), the fixes (keys, values, times, commands) on a synthetic mix, and what isn't scored.
 */
import { RationalTime, soundCritiqueFixSchema, soundCritiqueSchema, type SoundMeasures } from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import { critiqueSound, toSoundCritique } from '../../src/listen/critique/critique';
import { CRITIQUE_MESSAGE_KEYS } from '../../src/listen/critique/fixes';
import { musicWindowStarts } from '../../src/listen/critique/metrics-time';
import {
  aggregateProfile,
  FILM_METRIC_IDS,
  launchProfile,
  leaveOneOut,
  profileFromListening,
  referenceMatch,
} from '../../src/listen/critique/profile';
import { scorecard, windowOf } from '../../src/listen/critique/scorecard';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { pyRoundTo } from '../../src/listen/realness/py-round';

const runner = createSpectrogramRunner();
afterAll(() => runner.release());

describe('profile', () => {
  it('rebuilds the bundled launch profile from its own 7 films', () => {
    const launch = launchProfile();
    expect(launch.n).toBe(7);
    const rebuilt = aggregateProfile(launch.films);
    for (const id of FILM_METRIC_IDS) expect(rebuilt.metrics[id], id).toEqual(launch.metrics[id]);
    expect(rebuilt.arc).toEqual(launch.arc);
  });

  it('scores one of its own films leave-one-out', () => {
    const launch = launchProfile();
    const ref = launch.films[2];
    if (!ref) throw new Error('no ref_3');
    expect(referenceMatch({ duration: ref.duration + 0.02, metrics: ref.metrics }, launch)).toBe('ref_3');
    expect(referenceMatch({ duration: ref.duration + 0.2, metrics: ref.metrics }, launch)).toBeNull();
    const loo = leaveOneOut(launch, 'ref_3');
    expect([loo.n, loo.looOf, loo.nFull]).toEqual([6, 'ref_3', 7]);
    expect(loo.metrics.lufsI.values).not.toContain(ref.metrics.lufsI);
  });

  it('builds a reference profile from what a template kept of its reel', () => {
    const measures: SoundMeasures = {
      duration: RationalTime.of(30_000, { num: 1000, den: 1 }),
      lufs: -12.4,
      truePeakDbtp: -0.8,
      peakDbfs: -1,
      lraLu: 4.1,
      crestLu: 2.2,
      noiseFloorDbfs: -60,
      nearSilent: false,
      bandwidthHz: 16_000,
      brightnessHz: 2100,
      bands: { sub: -8, low: -4, lowmid: -6, mid: -12, presence: -18, air: -24 },
      sideToMidDb: null,
    };
    const p = profileFromListening({ measures }, { onsetRate: 4.2 });
    expect(p.n).toBe(1);
    expect(p.metrics.lra).toMatchObject({ n: 1, min: 4.1, max: 4.1 });
    expect(p.metrics.sideToMidDb).toMatchObject({ min: -40 });
    expect(p.metrics.onsetRate).toMatchObject({ min: 4.2 });
    expect(p.metrics.hitRate).toEqual({ n: 0 });
    expect(windowOf('lra', p.metrics.lra, false)).toEqual({
      lo: 3.0999999999999996,
      hi: 5.1,
      basis: 'references',
    });
    expect(windowOf('hitRate', p.metrics.hitRate, false).basis).toBe('no reference data');
    const card = scorecard({ lra: 9, hitRate: 1.2, pReal: 0.9 }, p);
    expect(card.rows.find((r) => r.id === 'lra')?.status).toBe('high');
    expect(card.rows.find((r) => r.id === 'hitRate')?.status).toBe('na');
  });
});

describe('scorecard', () => {
  const launch = launchProfile();
  const row = (values: Record<string, number | null>, id: string, lossy = false) =>
    scorecard(values, launch, {}, lossy).rows.find((r) => r.id === id);

  it('judges loudness against the web window, a near miss of a critical rule as major', () => {
    expect(row({ lufsI: -14 }, 'lufsI')).toMatchObject({
      status: 'ok',
      weight: 3,
      range: [-16, -9],
      basis: 'web',
    });
    expect(row({ lufsI: -17.5 }, 'lufsI')).toMatchObject({ status: 'low', weight: 2 });
    expect(row({ lufsI: -18.5 }, 'lufsI')).toMatchObject({ status: 'low', weight: 3 });
    expect(row({ lufsI: -6.5 }, 'lufsI')).toMatchObject({ status: 'high', weight: 3 });
  });

  it('weights realness by which side of 0.5 it falls, under the 0.77 line', () => {
    expect(row({ pReal: 0.8 }, 'pReal')).toMatchObject({ status: 'ok', weight: 3, range: [0.77, null] });
    expect(row({ pReal: 0.6 }, 'pReal')).toMatchObject({ status: 'low', weight: 1 });
    expect(row({ pReal: 0.3 }, 'pReal')).toMatchObject({ status: 'low', weight: 3 });
    expect(row({ pReal: null }, 'pReal')).toMatchObject({ status: 'na' });
  });

  it('holds true peak to −1 dBTP for a master and 0 for decoded lossy audio', () => {
    expect(row({ truePeak: -0.5 }, 'truePeak')).toMatchObject({ status: 'high', range: [null, -1] });
    expect(row({ truePeak: -0.5 }, 'truePeak', true)).toMatchObject({
      status: 'ok',
      range: [null, 0],
      basis: 'decoded lossy',
    });
  });

  it('floors a rate at half the sparsest reference, a duration at nothing', () => {
    const p = aggregateProfile([
      {
        id: 'a',
        duration: 30,
        hasVideo: true,
        metrics: { ...launch.films[0]!.metrics, hitRate: 0.1, maxGapS: 0.0 },
      },
      {
        id: 'b',
        duration: 30,
        hasVideo: true,
        metrics: { ...launch.films[1]!.metrics, hitRate: 1.2, maxGapS: 0.2 },
      },
    ]);
    expect(windowOf('hitRate', p.metrics.hitRate, false)).toMatchObject({ lo: 0.05 });
    expect(windowOf('maxGapS', p.metrics.maxGapS, false)).toMatchObject({ lo: null, hi: 0.45 });
  });

  it('gives the verdict bands', () => {
    const medians = Object.fromEntries(FILM_METRIC_IDS.map((id) => [id, launch.metrics[id].median ?? null]));
    const good = scorecard({ ...medians, pReal: 0.9 }, launch);
    expect(good.verdict).toBe('launch-grade');
    expect(scorecard({ ...medians, pReal: 0.2 }, launch).verdict).toBe('needs work');
    const close = scorecard({ ...medians, pReal: 0.9, hitRate: 5, onsetRate: 20, lra: 30 }, launch);
    expect(close.verdict).toBe('close');
    // The references' own median true peak (+0.6 dBTP) breaks the web rule.
    expect(close.rows.filter((r) => r.weight && r.status !== 'ok').map((r) => r.id)).toEqual([
      'truePeak',
      'lra',
      'onsetRate',
      'hitRate',
    ]);
    expect(scorecard({}, launch).verdict).toBe('n.a.');
  });
});

/** 14 s of noise hits on a beat, quiet, with a 2.5 s hole from 5.5 s and cuts off the beat. */
function synthMix(): Float32Array[] {
  const sr = 48_000;
  const n = 14 * sr;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let seed = 7;
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 1_073_741_824 - 1;
  };
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const beat = t % 0.5;
    const bed = 0.01 * Math.sin(2 * Math.PI * 110 * t);
    const hit = beat < 0.08 ? 0.15 * Math.exp(-beat * 40) * rand() : 0;
    const hole = t >= 5.5 && t < 8;
    l[i] = hole ? 0 : bed + hit;
    r[i] = hole ? 0 : 0.9 * (bed + hit) + 0.002 * rand();
  }
  return [l, r];
}

describe('fixes on a synthetic mix', () => {
  it('names a timestamped key for each problem, with the caller’s commands, and reads as core’s SoundCritique', async () => {
    const commands = {
      hitOnCut: ({ cutIndex }: { cutIndex: number }) => ({
        name: 'sfx.setHits' as const,
        payload: { cutIndex },
      }),
    };
    const r = await critiqueSound({
      audio: { sampleRate: 48_000, channels: synthMix() },
      runner,
      picture: { cuts: [1.0, 2.25, 3.5, 4.0, 6.6, 9.0, 10.27, 12.0], frameRate: { num: 30, den: 1 } },
      commands,
    });
    expect(r.unscorable).toBeNull();
    expect(r.partial).toEqual(['realness', 'music presence']);
    expect(r.notMeasured.not_run).toEqual(['pReal', 'musicFrac']);
    const keys: readonly string[] = CRITIQUE_MESSAGE_KEYS;
    for (const f of r.fixes) {
      expect(soundCritiqueFixSchema.safeParse(f).success, f.messageKey).toBe(true);
      expect(keys, f.messageKey).toContain(f.messageKey);
    }
    const lufs = r.fixes.find((f) => f.messageKey === 'audio.critique.fix.lufsLow');
    expect(lufs?.params['gainDb']).toBe(pyRoundTo(-14 - (r.film?.metrics.lufsI ?? 0), 1));
    const gap = r.fixes.find((f) => f.messageKey === 'audio.critique.fix.silentGap');
    expect(gap?.at && RationalTime.toSeconds(gap.at)).toBeCloseTo(5.5, 2);
    const cuts = r.fixes.filter((f) => f.messageKey === 'audio.critique.fix.cutNoSound');
    expect(cuts.map((f) => f.at && RationalTime.toSeconds(f.at))).toContain(6.6);
    expect(cuts.every((f) => f.command?.name === 'sfx.setHits' && f.params['cutIndex'] !== undefined)).toBe(
      true,
    );
    const core = toSoundCritique(r);
    expect(soundCritiqueSchema.safeParse(core).success).toBe(true);
    expect(core?.partial).toBe(true);
    expect(core?.metrics.find((m) => m.id === 'pReal')).toMatchObject({ status: 'na', value: null });
  });

  it('does not score a sound under 3 s or a silent one', async () => {
    const short = await critiqueSound({
      audio: { sampleRate: 48_000, channels: [new Float32Array(96_000)] },
      runner,
    });
    expect([short.unscorable, short.verdict, toSoundCritique(short)]).toEqual(['short', 'n.a.', null]);
    const silent = await critiqueSound({
      audio: { sampleRate: 48_000, channels: [new Float32Array(240_000)] },
      runner,
    });
    expect([silent.unscorable, toSoundCritique(silent)]).toEqual(['silent', null]);
  });

  it('cuts the AudioSet pass into 5 s windows, keeping a last one of 1 s or more', () => {
    expect(musicWindowStarts(48_000 * 11)).toEqual([0, 240_000, 480_000]);
    expect(musicWindowStarts(48_000 * 10.5)).toEqual([0, 240_000]);
    expect(musicWindowStarts(48_000 * 0.5)).toEqual([0]);
  });
});

describe('rounding like Python', () => {
  it('rounds the exact binary value, ties to even', () => {
    expect([pyRoundTo(0.125, 2), pyRoundTo(0.375, 2), pyRoundTo(2.675, 2), pyRoundTo(1.005, 2)]).toEqual([
      0.12, 0.38, 2.67, 1,
    ]);
    expect([pyRoundTo(0.5, 0), pyRoundTo(1.5, 0), pyRoundTo(-2.5, 0), pyRoundTo(-0.125, 2)]).toEqual([
      0, 2, -2, -0.12,
    ]);
  });
});
