// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R1, an analysis at its edges: a model that fails while running (a GPU error) with `optionalModels` leaves
 * realness null and the critique partial, keeps the cut sync and the audit, logs one line and is not cached
 * (render QA's model-free checks must still answer); without `optionalModels` it still fails. A range past the end
 * is `listen_bad_input`. A beat over a minute from an event or a cut is no beat offset (core's ±60 s), so the
 * analysis validates.
 */
import { err, ok, RationalTime } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { analyseSound } from '../../src/listen/analysis/analyse';
import { soundAnalysisSchema } from '../../src/listen/analysis/schema';
import { createSoundCritic } from '../../src/listen/critique/critic';
import { ListenFailed } from '../../src/listen/errors';
import { hitsAt, stereo } from './dsp-signals';
import { analysisRig } from './analysis-rig';

const ms = (s: number) => RationalTime.fromSeconds(s, { num: 1000, den: 1 });
const HITS = [0.5, 1.25, 2.0, 2.75];
const left = hitsAt(HITS, 3.5);
const audio = stereo(
  left,
  Float32Array.from(left, (v) => v * 0.5),
);
/** Render QA's question (listener.ts): DSP checks, realness and the critique, nothing downloaded, models optional. */
const qa = {
  pcm: audio,
  cuts: HITS.map(ms),
  frameRate: { num: 30, den: 1 },
  want: { measures: true, events: true, audit: true, realness: true },
  critique: { profile: 'launch' },
  install: false,
  optionalModels: true,
} as const;
const builds = () => ({ 'clap-general-audio-fp16': 'v1', 'ast-audioset-fp16': 'v1' });

describe('a model that fails while running', () => {
  it('with optionalModels: realness null, the critique partial, cut sync and audit kept, nothing cached', async () => {
    const rig = analysisRig({ disk: { builds: builds() }, runFails: true, critic: createSoundCritic() });
    const analysed = await analyseSound(rig.deps, qa);
    expect(analysed.ok).toBe(true);
    if (!analysed.ok) return;
    const { value } = analysed;
    expect(value.cutSync?.items.map((item) => item.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(value.audit).not.toBeNull();
    expect(value.realness).toBeNull();
    expect(value.critique?.partial).toBe(true);
    expect(rig.lines).toEqual([
      expect.stringMatching(/^\[listen\] realness left out \(audio\.listen_failed\)/),
    ]);
    expect(rig.json.entries.size).toBe(0);
  });

  it('AST failing inside the critique leaves its music share unmeasured, and the analysis uncached', async () => {
    const rig = analysisRig({
      disk: { builds: builds() },
      runFails: true,
      critic: createSoundCritic(),
      // Realness without a model run, so the models reach the critique and AST is the one that fails.
      realness: async () => ok({ pReal: 0.9, verdict: 'real' }),
    });
    const analysed = await analyseSound(rig.deps, qa);
    expect(analysed.ok && analysed.value.realness).toEqual({ pReal: 0.9, verdict: 'real' });
    expect(analysed.ok && analysed.value.critique?.partial).toBe(true);
    expect(rig.lines).toEqual([expect.stringMatching(/critique's ast left out \(audio\.listen_failed\)/)]);
    expect(rig.json.entries.size).toBe(0);
  });

  it('a critic that fails leaves the critique null (optionalModels), uncached', async () => {
    const rig = analysisRig({
      disk: { builds: builds() },
      critic: async () => err(ListenFailed(undefined, { detail: 'ORT session failed' })),
    });
    const analysed = await analyseSound(rig.deps, qa);
    expect(analysed.ok && analysed.value.critique).toBeNull();
    expect(analysed.ok && analysed.value.realness).toEqual({ pReal: 0.8, verdict: 'real' });
    expect(rig.lines).toEqual([expect.stringMatching(/critique left out \(audio\.listen_failed\)/)]);
    expect(rig.json.entries.size).toBe(0);
  });

  it('without optionalModels the error is the analysis’s', async () => {
    const rig = analysisRig({ disk: { builds: builds() }, runFails: true });
    const failed = await analyseSound(rig.deps, { ...qa, optionalModels: false, critique: undefined });
    expect(!failed.ok && failed.error.code).toBe('audio.listen_failed');
  });
});

describe('ranges and beats', () => {
  it('a range past the end is listen_bad_input, not an empty analysis', async () => {
    const rig = analysisRig({ disk: { builds: {} } });
    const past = await analyseSound(rig.deps, {
      pcm: audio,
      range: { start: ms(10), duration: ms(2) },
      want: { measures: true, events: true, audit: true },
    });
    expect(!past.ok && past.error.code).toBe('audio.listen_bad_input');
    expect(!past.ok && past.error.detail).toMatch(/starts past the end/);
  });

  it('a beat over a minute from an event or a cut gives no beat offset; the analysis validates', async () => {
    const long = new Float32Array(48_000 * 70);
    for (const t of [1, 65, 66])
      for (let i = 0; i < 480; i++) long[Math.round(t * 48_000) + i] = 0.8 * Math.exp(-i / 100) * Math.sin(i);
    const rig = analysisRig({ disk: { builds: {} } });
    const analysed = await analyseSound(rig.deps, {
      pcm: stereo(long, long),
      beats: [ms(0.5), ms(1)],
      cuts: [ms(1), ms(65)],
      want: { events: true },
    });
    expect(analysed.ok).toBe(true);
    if (!analysed.ok) return;
    expect(soundAnalysisSchema.safeParse(analysed.value).success).toBe(true);
    const near = analysed.value.events.filter((e) => RationalTime.toSeconds(e.at) < 2);
    const far = analysed.value.events.filter((e) => RationalTime.toSeconds(e.at) > 60);
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((e) => e.beatOffsetMs !== undefined)).toBe(true);
    expect(far.length).toBeGreaterThan(0);
    expect(far.every((e) => e.beatOffsetMs === undefined)).toBe(true);
    expect(analysed.value.cutSync?.items.map((item) => item.beatOffsetMs)).toEqual([0, undefined]);
  });
});
