// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F7 analysis and cache: a repeat analysis of the same content is a cache hit that opens no session and runs
 * no spectrogram; a new question misses; a missing model fails with `audio.listen_model_missing` naming the
 * component (or, optional, leaves the model parts null); only what is asked runs. A fake onnxruntime stands in for
 * the models (no files, no GPU); the DSP runs on its f64 oracle.
 */
import { DERIVED_KEY_PATTERN, err, ok, RationalTime } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  analyseSound,
  type ListenAnalysisDeps,
  type ListenModelSet,
} from '../../src/listen/analysis/analyse';
import { createListenAnalysisCache, listenCacheKey } from '../../src/listen/analysis/cache';
import type { RealnessScorer } from '../../src/listen/analysis/extensions';
import { createListenModels } from '../../src/listen/describe/context';
import { createSpectrogramRunner, type SpectrogramRunner } from '../../src/listen/dsp/spectrogram-graph';
import { ListenModelMissing } from '../../src/listen/errors';
import {
  LISTEN_COMPONENTS,
  type ListenModelFiles,
  type ListenModelName,
} from '../../src/listen/models/files';
import { createListenSessions } from '../../src/listen/models/sessions';
import type { DerivedJson } from '../../src/cleanup/speech-files';
import { hitsAt, stereo } from './dsp-signals';
import { fakeOrt, type OrtLog } from './analysis-fakes';

const HITS = [0.5, 1.25, 2.0, 2.75];
const left = hitsAt(HITS, 3.5);
const audio = stereo(
  left,
  Float32Array.from(left, (v) => v * 0.5),
);
const ms = (s: number) => RationalTime.fromSeconds(s, { num: 1000, den: 1 });

function memoryJson(): DerivedJson & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    async read(key) {
      const found = entries.get(key);
      return found === undefined ? err(ListenModelMissing({ component: 'none' })) : ok(JSON.parse(found));
    },
    async write(key, json) {
      entries.set(key, JSON.stringify(json));
      return ok(undefined);
    },
  };
}

function files(missing: readonly ListenModelName[] = []): ListenModelFiles & { readonly asked: string[] } {
  const asked: string[] = [];
  const build = (name: ListenModelName) => {
    const id = `${LISTEN_COMPONENTS[name]}-fp16`;
    return {
      name,
      componentId: id,
      dir: `/models/${id}`,
      modelPath: `/models/${id}/model.onnx`,
      dtype: 'fp16' as const,
    };
  };
  return {
    asked,
    async resolve(name) {
      asked.push(`resolve:${name}`);
      return missing.includes(name)
        ? err(ListenModelMissing({ component: LISTEN_COMPONENTS[name] }))
        : ok(build(name));
    },
    async installed(name) {
      asked.push(`installed:${name}`);
      return missing.includes(name) ? undefined : build(name);
    },
  };
}

interface Rig {
  readonly deps: ListenAnalysisDeps;
  readonly log: OrtLog;
  readonly counts: { runners: number; spectrograms: number; realness: number };
  readonly json: ReturnType<typeof memoryJson>;
}

function rig(
  options: { missing?: readonly ListenModelName[]; json?: ReturnType<typeof memoryJson> } = {},
): Rig {
  const log: OrtLog = { opened: [], released: [] };
  const counts = { runners: 0, spectrograms: 0, realness: 0 };
  const json = options.json ?? memoryJson();
  const modelFiles = files(options.missing);
  let set: ListenModelSet | undefined;
  let runner: SpectrogramRunner | undefined;
  const realness: RealnessScorer = async ({ models, source }) => {
    counts.realness++;
    if (!models) return ok(null);
    const embedded = await models.clap.embedSource(source.samples);
    if (!embedded.ok) return embedded;
    return ok({ pReal: 0.8, verdict: 'real' });
  };
  const deps: ListenAnalysisDeps = {
    async spectrograms() {
      if (!runner) {
        counts.runners++;
        const made = createSpectrogramRunner({ plan: { devices: ['cpu'] } });
        runner = {
          ...made,
          spectrogram: (spec, block) => (counts.spectrograms++, made.spectrogram(spec, block)),
          segmentPower: (segments, count, n) => (
            counts.spectrograms++,
            made.segmentPower(segments, count, n)
          ),
        };
      }
      return runner;
    },
    async models() {
      if (!set) {
        const sessions = createListenSessions({ files: modelFiles, loadModule: async () => fakeOrt(log) });
        set = { sessions, files: modelFiles, models: createListenModels(sessions, modelFiles) };
      }
      return set;
    },
    cache: createListenAnalysisCache(json),
    realness,
  };
  return { deps, log, counts, json };
}

const ask = {
  pcm: audio,
  cuts: HITS.map(ms),
  frameRate: { num: 30, den: 1 },
  want: { measures: true, events: true, audit: true, realness: true },
} as const;

describe('analyseSound and its cache', () => {
  it('runs what was asked, then a repeat opens 0 sessions and runs no spectrogram', async () => {
    const first = rig();
    const analysed = await analyseSound(first.deps, ask);
    expect(analysed.ok).toBe(true);
    if (!analysed.ok) return;
    const value = analysed.value;
    expect(value.measures?.nearSilent).toBe(false);
    expect(value.events.filter((e) => e.shape === 'hit').length).toBeGreaterThanOrEqual(HITS.length);
    expect(value.cutSync?.items.map((item) => item.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(value.audit).not.toBeNull();
    expect(value.realness).toEqual({ pReal: 0.8, verdict: 'real' });
    expect(value.model).toMatchObject({ dtype: 'fp16', ast: null, configVersion: 'ear1-1' });
    // Not asked: nothing ran.
    expect(value.tags).toBeNull();
    expect(value.sections).toEqual([]);
    expect(value.measures?.key).toBeUndefined();
    expect(first.log.opened.length).toBeGreaterThan(0);
    expect(first.counts.spectrograms).toBeGreaterThan(0);
    expect([...first.json.entries.keys()].every((key) => DERIVED_KEY_PATTERN.test(key))).toBe(true);

    // The same content again, as a new process would see it (fresh sessions and runner, the same cache).
    const again = rig({ json: first.json });
    const hit = await analyseSound(again.deps, ask);
    expect(hit.ok && hit.value).toEqual(value);
    expect(again.log.opened).toEqual([]);
    expect(again.counts).toEqual({ runners: 0, spectrograms: 0, realness: 0 });

    // And in the same process: no new session either.
    const opened = first.log.opened.length;
    expect((await analyseSound(first.deps, ask)).ok).toBe(true);
    expect(first.log.opened.length).toBe(opened);
    expect(first.counts.realness).toBe(1);
  });

  it('a new question or new content misses the cache', async () => {
    const { deps, counts } = rig();
    expect((await analyseSound(deps, ask)).ok).toBe(true);
    const runs = counts.realness;
    expect((await analyseSound(deps, { ...ask, cuts: [ms(0.5)] })).ok).toBe(true);
    const louder = stereo(
      Float32Array.from(left, (v) => v * 0.9),
      Float32Array.from(left, (v) => v * 0.45),
    );
    expect((await analyseSound(deps, { ...ask, pcm: louder })).ok).toBe(true);
    expect(counts.realness).toBe(runs + 2);
  });

  it('the key covers the models, the config version and every option', () => {
    const hash = 'ab'.repeat(32);
    const a = listenCacheKey(hash, 'none', { want: { measures: true } });
    expect(a).toMatch(/^listen\/ab\/(ab){32}\.listen\.[0-9a-f]{32}\.v1\.json$/);
    expect(listenCacheKey(hash, 'none', { want: { measures: true }, install: false })).toBe(a);
    expect(listenCacheKey(hash, 'clap|int8', { want: { measures: true } })).not.toBe(a);
    expect(listenCacheKey(hash, 'none', { want: { measures: true, key: true } })).not.toBe(a);
    expect(listenCacheKey('cd'.repeat(32), 'none', { want: { measures: true } })).not.toBe(a);
  });

  it('a missing model fails with audio.listen_model_missing naming the component', async () => {
    const { deps, counts } = rig({ missing: ['ast'] });
    const failed = await analyseSound(deps, { pcm: audio, want: { tags: true } });
    expect(!failed.ok && failed.error.code).toBe('audio.listen_model_missing');
    expect(!failed.ok && failed.error.params).toEqual({ component: 'ast-audioset' });
    // It fails before decoding or running anything.
    expect(counts.runners).toBe(0);
  });

  it('install: false never installs: a model not on disk is missing', async () => {
    const { deps } = rig({ missing: ['clapAudio'] });
    const failed = await analyseSound(deps, { pcm: audio, want: { realness: true }, install: false });
    expect(!failed.ok && failed.error.params).toEqual({ component: 'clap-general-audio' });
  });

  it('with optionalModels the signal processing still answers, the model parts null', async () => {
    const { deps } = rig({ missing: ['clapAudio'] });
    const analysed = await analyseSound(deps, { ...ask, optionalModels: true });
    expect(analysed.ok).toBe(true);
    if (!analysed.ok) return;
    expect(analysed.value.model).toBeNull();
    expect(analysed.value.realness).toBeNull();
    expect(analysed.value.cutSync?.okShare).toBe(1);
  });

  it('needs exactly one of a path and decoded audio', async () => {
    const { deps } = rig();
    const none = await analyseSound(deps, { want: { measures: true } });
    expect(!none.ok && none.error.code).toBe('audio.listen_bad_input');
    const both = await analyseSound(deps, { ...ask, path: '/x.wav' });
    expect(!both.ok && both.error.code).toBe('audio.listen_bad_input');
  });

  it('the key and tempo run only when asked, from 5 s', async () => {
    const { deps } = rig();
    const long = hitsAt([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5], 6);
    const analysed = await analyseSound(deps, { pcm: stereo(long, long), want: { key: true, tempo: true } });
    expect(analysed.ok).toBe(true);
    if (!analysed.ok) return;
    expect(analysed.value.measures?.key).not.toBeUndefined();
    expect(analysed.value.measures?.tempo).not.toBeUndefined();
    expect(analysed.value.events).toEqual([]);
    expect(analysed.value.cutSync).toBeNull();
  });
});
