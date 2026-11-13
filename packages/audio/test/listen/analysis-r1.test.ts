// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R1, what an analysis is keyed on and runs on: a component update is a new key (the install folder names the
 * version); a critique's key names the AST its music share ran on, or none; `install: false` downloads nothing at
 * planning or at run time and counts only this machine's build; a model skipped for a reason that may pass (an
 * install that failed) is not cached, one skipped because the request said not to install is.
 */
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { analyseSound } from '../../src/listen/analysis/analyse';
import type { CritiqueInput } from '../../src/listen/analysis/hooks';
import { hitsAt, stereo } from './dsp-signals';
import { analysisRig, memoryJson } from './analysis-rig';

const left = hitsAt([0.5, 1.25, 2.0, 2.75], 3.5);
const audio = stereo(
  left,
  Float32Array.from(left, (v) => v * 0.5),
);
const realnessOnly = { pcm: audio, want: { measures: true, realness: true } } as const;
const critiqued = { ...realnessOnly, critique: { profile: 'launch' } } as const;

describe('the analysis key', () => {
  it('a component update (same id, new version folder) is a new key: the stale analysis is not served', async () => {
    const json = memoryJson();
    const builds = { 'clap-general-audio-fp16': 'v1' };
    const before = analysisRig({ disk: { builds }, json });
    expect((await analyseSound(before.deps, realnessOnly)).ok).toBe(true);
    expect(json.entries.size).toBe(1);
    const same = analysisRig({ disk: { builds }, json });
    expect((await analyseSound(same.deps, realnessOnly)).ok).toBe(true);
    expect(same.counts.realness).toBe(0);
    const updated = analysisRig({ disk: { builds: { 'clap-general-audio-fp16': 'v2' } }, json });
    expect((await analyseSound(updated.deps, realnessOnly)).ok).toBe(true);
    expect(updated.counts.realness).toBe(1);
    expect(json.entries.size).toBe(2);
  });

  it('a critique made before AST was installed is not served once it is', async () => {
    const json = memoryJson();
    const seen: boolean[] = [];
    const critic = async (input: CritiqueInput) => {
      seen.push((await input.mayLoad?.('ast')) ?? true);
      return ok(null);
    };
    const ask = { ...critiqued, install: false, optionalModels: true } as const;
    const builds: Record<string, string> = { 'clap-general-audio-fp16': 'v1' };
    expect((await analyseSound(analysisRig({ disk: { builds }, json, critic }).deps, ask)).ok).toBe(true);
    builds['ast-audioset-fp16'] = 'v1';
    expect((await analyseSound(analysisRig({ disk: { builds }, json, critic }).deps, ask)).ok).toBe(true);
    // The second is a miss (its key names the AST build), and the critic is told it may run AST.
    expect(seen).toEqual([false, true]);
    // A third, with AST still there, is a hit.
    expect((await analyseSound(analysisRig({ disk: { builds }, json, critic }).deps, ask)).ok).toBe(true);
    expect(seen).toEqual([false, true]);
  });
});

describe('install: false', () => {
  it('on a Metal Mac with only the int8 build on disk, nothing is downloaded and the model parts are null', async () => {
    const rig = analysisRig({ disk: { builds: { 'clap-general-audio': 'v1' } } });
    const analysed = await analyseSound(rig.deps, { ...critiqued, install: false, optionalModels: true });
    expect(analysed.ok && analysed.value.model).toBeNull();
    expect(analysed.ok && analysed.value.measures).not.toBeNull();
    expect(rig.files.downloads).toEqual([]);
  });

  it('with this machine’s build installed it runs, and the critique’s AST is never downloaded', async () => {
    const seen: boolean[] = [];
    const rig = analysisRig({
      disk: { builds: { 'clap-general-audio-fp16': 'v1' } },
      critic: async (input) => (seen.push((await input.mayLoad?.('ast')) ?? true), ok(null)),
    });
    const analysed = await analyseSound(rig.deps, { ...critiqued, install: false, optionalModels: true });
    expect(analysed.ok && analysed.value.realness).toEqual({ pReal: 0.8, verdict: 'real' });
    expect(analysed.ok && analysed.value.model?.dtype).toBe('fp16');
    expect(seen).toEqual([false]);
    expect(rig.files.downloads).toEqual([]);
  });

  it('when installs are allowed, the critique’s AST is installed for its music share, as before', async () => {
    const seen: boolean[] = [];
    const rig = analysisRig({
      disk: { builds: { 'clap-general-audio-fp16': 'v1' } },
      critic: async (input) => (seen.push((await input.mayLoad?.('ast')) ?? true), ok(null)),
    });
    expect((await analyseSound(rig.deps, critiqued)).ok).toBe(true);
    expect(rig.files.downloads).toEqual(['ast-audioset-fp16']);
    expect(seen).toEqual([true]);
  });
});

describe('what is cached when a model is skipped', () => {
  it('an install that failed (offline) is not cached: the next analysis tries again', async () => {
    const rig = analysisRig({ disk: { builds: {}, offline: true } });
    const analysed = await analyseSound(rig.deps, { ...realnessOnly, optionalModels: true });
    expect(analysed.ok && analysed.value.model).toBeNull();
    expect(rig.json.entries.size).toBe(0);
  });

  it('a model the request said not to install, and isn’t, is a lasting answer: cached', async () => {
    const rig = analysisRig({ disk: { builds: {} } });
    const ask = { ...realnessOnly, install: false, optionalModels: true } as const;
    expect((await analyseSound(rig.deps, ask)).ok).toBe(true);
    expect(rig.json.entries.size).toBe(1);
    expect(rig.files.downloads).toEqual([]);
  });
});
