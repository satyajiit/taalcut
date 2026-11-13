// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Audio's index stages: the jobs they build from the library's view, their skips, and what they store. */
import {
  newId,
  type AssetIndexView,
  type BeatMap,
  type IndexStageDefinition,
  type Transcript,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { AUDIO_SKIP, createAudioIndexStages, type IdentifyLanguageOutput } from '../src';
import { msRange } from '../src/rates';
import { audioPlan } from './helpers/audio-pass';

const HASH = 'ef'.repeat(32);
const measure = {
  integratedLufs: -20,
  loudnessRange: 4,
  truePeakDbtp: -2,
  nonSilentRatio: 0.8,
  nonSilentMs: 8000,
  durationMs: 10_000,
};

function view(overrides: Partial<AssetIndexView> = {}): AssetIndexView {
  return {
    assetId: newId<'Asset'>(),
    generation: 1,
    kind: 'video',
    path: '/footage/talk.mov',
    contentHash: HASH,
    sizeBytes: 1000,
    sourceId: newId<'Source'>(),
    capturedAt: null,
    facts: null,
    derived: [],
    shots: [],
    transcript: null,
    outputs: {},
    ...overrides,
  };
}

const facts = (hasAudio: boolean) =>
  ({
    hasAudio,
    version: 1,
    width: 1920,
    height: 1080,
    orientation: 'landscape',
    variableFrameRate: false,
    hdr: 'none',
    speed: 'normal',
    speedFactor: 1,
    retimedInFile: false,
  }) as const;

const stages = createAudioIndexStages();
const byName = (name: string) => stages.find((stage) => stage.stage === name) as IndexStageDefinition;

const spoken: IdentifyLanguageOutput = {
  silent: false,
  measure,
  detected: { language: 'hi', probability: 0.9, perSlice: [{ language: 'hi', probability: 0.9 }] },
};

describe('audio index stages', () => {
  it('follows the library SPEC table', () => {
    expect(stages.map((s) => [s.stage, s.needs, s.appliesTo])).toEqual([
      ['audio.language', ['media.normalise'], ['video', 'audio']],
      ['audio.transcript', ['audio.language'], ['video', 'audio']],
      ['audio.beats', ['media.normalise'], ['audio']],
    ]);
  });

  it('says what it reads, and what the stages others read store for them (IX3-I2)', () => {
    expect(stages.map((s) => [s.stage, s.reads])).toEqual([
      ['audio.language', ['media.normalise']],
      ['audio.transcript', ['audio.language', 'media.normalise']],
      ['audio.beats', ['media.normalise']],
    ]);
    const language = byName('audio.language').stores;
    const identified = view({ outputs: { 'audio.language': spoken } });
    expect(language?.(identified)).toEqual({ silent: false, detected: spoken.detected, decision: null });
    // The loudness is the measure's, not what the transcript reads: it changes nothing stored for readers.
    const louder = view({
      outputs: { 'audio.language': { ...spoken, measure: { ...measure, integratedLufs: -14 } } },
    });
    expect(language?.(louder)).toEqual(language?.(identified));
    expect(language?.(view())).toBeNull();
    expect(byName('audio.transcript').stores?.(view())).toBeNull();
    expect(byName('audio.beats').stores).toBeUndefined();
  });

  it('skips files without an audio stream', () => {
    const silentFile = view({ facts: facts(false) });
    expect(byName('audio.language').job(silentFile)).toEqual({ skip: AUDIO_SKIP.noAudio });
    expect(byName('audio.transcript').job(silentFile)).toEqual({ skip: AUDIO_SKIP.noAudio });
    expect(byName('audio.beats').job(view({ kind: 'audio', facts: facts(false) }))).toEqual({
      skip: AUDIO_SKIP.noAudio,
    });
  });

  it('identifies the language, then transcribes with what it found', () => {
    expect(byName('audio.language').job(view({ facts: facts(true) }))).toMatchObject({
      kind: { kind: 'audio.identifyLanguage' },
      input: { path: '/footage/talk.mov', contentHash: HASH },
    });
    expect(byName('audio.language').result(spoken, view())).toEqual({ ok: true, value: { language: 'hi' } });
    const after = view({ facts: facts(true), outputs: { 'audio.language': spoken } });
    expect(byName('audio.transcript').job(after)).toMatchObject({
      kind: { kind: 'audio.transcribeAssetWhisper', resource: 'gpu', lane: 'audio.whisper' },
      input: { perSlice: [{ language: 'hi', probability: 0.9 }], language: 'hi', contentHash: HASH },
    });
  });

  it("sends Parakeet's languages to the Parakeet kind while it is installed, and to whisper otherwise", () => {
    let ready = false;
    const routed = createAudioIndexStages({ parakeetReady: () => ready });
    const transcript = routed.find((stage) => stage.stage === 'audio.transcript') as IndexStageDefinition;
    const slice = { language: 'es', probability: 0.8 };
    const spanish: IdentifyLanguageOutput = { ...spoken, detected: { ...slice, perSlice: [slice] } };
    const after = view({ facts: facts(true), outputs: { 'audio.language': spanish } });
    expect(transcript.job(after)).toMatchObject({ kind: { kind: 'audio.transcribeAssetWhisper' } });
    ready = true;
    expect(transcript.job(after)).toMatchObject({
      kind: { kind: 'audio.transcribeAssetParakeet', resource: 'npu', lane: 'audio.parakeet' },
      input: { language: 'es' },
    });
    const hindi = view({ facts: facts(true), outputs: { 'audio.language': spoken } });
    expect(transcript.job(hindi)).toMatchObject({ kind: { kind: 'audio.transcribeAssetWhisper' } });
  });

  it("hands both speech stages normalise's plan, so the audio pass needs no probe", () => {
    const plan = audioPlan(10_000, 480);
    const normalise = { plan, facts: plan.facts };
    const before = view({ facts: facts(true), outputs: { 'media.normalise': normalise } });
    expect(byName('audio.language').job(before)).toMatchObject({ input: { plan } });
    const after = view({
      facts: facts(true),
      outputs: { 'media.normalise': normalise, 'audio.language': spoken },
    });
    expect(byName('audio.transcript').job(after)).toMatchObject({ input: { plan } });
    expect(byName('audio.language').job(view({ facts: facts(true) }))).not.toHaveProperty('input.plan');
  });

  it('stores no speech for a silent asset and skips its transcript', () => {
    const silent: IdentifyLanguageOutput = {
      silent: true,
      measure: { ...measure, nonSilentMs: 200 },
      detected: { language: null, probability: null, perSlice: [] },
    };
    expect(byName('audio.language').result(silent, view())).toEqual({
      ok: true,
      value: { transcript: null },
    });
    const after = view({ facts: facts(true), outputs: { 'audio.language': silent } });
    expect(byName('audio.transcript').job(after)).toEqual({ skip: AUDIO_SKIP.silent });
  });

  it('stores the transcript, and leaves the language to the language stage (LIB1-LANG)', () => {
    const transcript: Transcript = {
      version: 1,
      language: 'en',
      segments: [
        {
          text: 'hello',
          range: msRange(0, 400),
          language: 'en',
          words: [{ text: 'hello', range: msRange(0, 400) }],
        },
      ],
      engine: 'whisper',
      model: 'whisper-medium-q5_0',
      local: true,
      wordTiming: 'native',
    };
    const stored = byName('audio.transcript').result(transcript, view());
    expect(stored).toMatchObject({ ok: true, value: { transcript: { engine: 'whisper' } } });
    // Whisper's own guess while transcribing no longer files the clip.
    expect(stored.ok && 'language' in stored.value).toBe(false);
  });

  it('tracks beats on music files and hands the library their beat map', () => {
    expect(byName('audio.beats').job(view({ kind: 'audio', facts: facts(true) }))).toMatchObject({
      kind: { kind: 'audio.trackBeats' },
      input: { contentHash: HASH },
    });
    const beatMap: BeatMap = {
      rate: { num: 1000, den: 1 },
      beats: [0, 500, 1000].map((ms) => ({ value: ms, rate: { num: 1000, den: 1 } })),
      downbeats: [0],
      bpm: 120,
      beatsPerBar: 4,
      confidence: 0.9,
      source: 'tracker',
    };
    const output = {
      beatMap,
      downbeatSource: 'model',
      flags: [],
      envelope: { rate: { num: 50, den: 1 }, peaks: [] },
      model: 'beat-this',
    };
    expect(byName('audio.beats').result(output, view())).toEqual({ ok: true, value: { beats: beatMap } });
  });
});
