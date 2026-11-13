// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-A1's realness and critique as F7's analysis plugs them in (analysis/extensions.ts): no models (a partial
 * critique, no realness), the stored embeddings as the CLAP model, a reel's profile, and realness through core's
 * SoundRealness and back.
 */
import {
  RationalTime,
  soundCritiqueSchema,
  soundRealnessSchema,
  type TemplateListening,
} from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import { blobRows, cliRun, ffmpegMono, loadClip } from '../../../../tools/earshot-parity/fixtures.mjs';
import type { ListenPassInput } from '../../src/listen/analysis/extensions';
import { EMPTY_ANALYSIS } from '../../src/listen/analysis/schema';
import { createSoundCritic } from '../../src/listen/critique/critic';
import type { ListenModels } from '../../src/listen/describe/context';
import { createSpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { realnessFromSound, realnessOf, toSoundRealness } from '../../src/listen/realness/realness';
import { createRealnessScorer } from '../../src/listen/realness/scorer';
import type { UpstreamRealness } from './realness-helpers';

const runner = createSpectrogramRunner();
afterAll(() => runner.release());
const ms = (s: number) => RationalTime.fromSeconds(s, { num: 1000, den: 1 });

function passOf(id: string, models: ListenModels | null): ListenPassInput {
  const clip = loadClip(id);
  return {
    audio: { sampleRate: clip.sampleRate, channels: clip.channels },
    source: { samples: ffmpegMono(clip), channels: clip.channels.length },
    spectrograms: runner,
    models,
  };
}

/** A CLAP stand-in that returns the fixtures' stored embeddings for `key`. */
function storedClap(key: string): ListenModels {
  const rows = blobRows(key);
  return { clap: { embedSegments: async () => ({ ok: true, value: rows }) } } as unknown as ListenModels;
}

describe('the F7 plug-ins', () => {
  it('scores realness through the models, null without them', async () => {
    const scorer = createRealnessScorer();
    const none = await scorer(passOf('speech-04', null));
    expect(none).toEqual({ ok: true, value: null });
    const scored = await scorer(passOf('speech-04', storedClap('realness/speech-04')));
    if (!scored.ok || !scored.value) throw new Error('no realness');
    expect(soundRealnessSchema.safeParse(scored.value).success).toBe(true);
    expect(scored.value.verdict).toBe('synthetic');
    expect(scored.value.pReal).toBeCloseTo(cliRun<UpstreamRealness>('realness', 'speech-04').p_real ?? 0, 2);
  });

  it('keeps p_real, the windows and their counts through core’s SoundRealness', async () => {
    const r = await realnessOf(ffmpegMono(loadClip('edge-long-70s')), {
      embedSegments: async () => ({ ok: true, value: blobRows('realness/edge-long-70s') }),
    });
    if (!r.ok) throw new Error('no realness');
    const back = realnessFromSound(toSoundRealness(r.value));
    expect([back.pReal, back.verdict, back.long, back.synthWindows, back.leanSynthWindows]).toEqual([
      r.value.pReal,
      r.value.verdict,
      true,
      r.value.synthWindows,
      r.value.leanSynthWindows,
    ]);
    expect(back.segments?.map((s) => s.verdict)).toEqual(r.value.segments?.map((s) => s.verdict));
  });

  it('critiques a pass against the launch films, partial without models', async () => {
    const up = cliRun<{ events: { visual: number[] } }>('critique', 'film-03');
    const critic = createSoundCritic();
    const out = await critic({
      ...passOf('film-03', null),
      analysis: EMPTY_ANALYSIS,
      cuts: up.events.visual.map(ms),
      beats: [],
      frameRate: { num: 30, den: 1 },
      request: { profile: 'launch' },
    });
    if (!out.ok || !out.value) throw new Error('no critique');
    expect(soundCritiqueSchema.safeParse(out.value).success).toBe(true);
    expect(out.value).toMatchObject({ profile: 'launch', partial: true });
    expect(out.value.metrics.find((m) => m.id === 'cutsWithSound')?.status).toBe('ok');
  });

  it('critiques against the template reel, and asks for the reel when it is missing', async () => {
    const critic = createSoundCritic();
    const base = {
      ...passOf('film-05', null),
      analysis: EMPTY_ANALYSIS,
      cuts: [],
      beats: [],
    };
    const missing = await critic({ ...base, request: { profile: 'reference' } });
    expect(missing.ok).toBe(false);
    const reference = {
      measures: {
        duration: ms(40),
        lufs: -14,
        truePeakDbtp: -1.2,
        peakDbfs: -1.5,
        lraLu: 5,
        crestLu: 2,
        noiseFloorDbfs: -60,
        nearSilent: false,
        bandwidthHz: 16_000,
        brightnessHz: 2000,
        bands: { sub: -8, low: -4, lowmid: -6, mid: -12, presence: -18, air: -24 },
        sideToMidDb: -9,
      },
    } as unknown as TemplateListening;
    const out = await critic({ ...base, request: { profile: 'reference', reference } });
    if (!out.ok || !out.value) throw new Error('no critique');
    expect(out.value.profile).toBe('reference');
    expect(out.value.metrics.find((m) => m.id === 'onsetRate')).toMatchObject({ status: 'na', range: null });
    expect(out.value.metrics.find((m) => m.id === 'lra')?.range).toEqual({ min: 4, max: 6 });
  });
});
