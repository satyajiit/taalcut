// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F5's describe, rank and compare logic without models: fake wrappers hand back upstream's own embeddings and
 * AST probabilities, so the tags, hints, AudioSet labels, character, ranking and typicality must equal upstream's
 * CLI output exactly. Near silence and too-short input come back untagged.
 */
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { blob, blobRows, cli, clip, intermediate } from '../../../../tools/earshot-parity/fixtures.mjs';
import { createVocab } from '../../src/listen/calibrate/vocab';
import { compareSound, differences, typicality } from '../../src/listen/describe/compare';
import type { ListenModels, ListenSource } from '../../src/listen/describe/context';
import { describeSound } from '../../src/listen/describe/describe';
import { rankSounds } from '../../src/listen/describe/rank';
import { modelMono } from './models-helpers';

const vocab = createVocab(blobRows('clap-text/vocab'));
const text = intermediate<{ queries: { texts: string[] } }>('text');
const labels = intermediate<{ labels: string[] }>('ast').labels;

/** Which clip a buffer holds: every view describe takes shares its source's buffer. */
const clipOf = new Map<ArrayBufferLike, string>();
const idOf = (samples: Float32Array) => clipOf.get(samples.buffer) ?? '';

/** Upstream's vectors for whichever clip a buffer holds. */
function fakeModels(): ListenModels {
  return {
    clap: {
      embedSource: async (samples: Float32Array) =>
        ok({ spans: [], windows: [], pooled: blob(`clap-audio/${idOf(samples)}`).data }),
    },
    ast: {
      labels: async () => ok(labels),
      probs: async (sources: readonly Float32Array[]) =>
        ok(sources.map((s) => ({ logits: [], probs: blob(`ast-probs/${idOf(s)}`).data }))),
    },
    text: {
      vocab: async () => ok(vocab),
      queries: async (texts: readonly string[]) =>
        ok({
          vocab,
          queries: texts.map((t) => ({
            text: t,
            embedding: blobRows('clap-text/queries')[text.queries.texts.indexOf(t)] ?? new Float32Array(),
          })),
        }),
    },
  } as unknown as ListenModels;
}

function source(id: string): ListenSource {
  const samples = modelMono(id);
  clipOf.set(samples.buffer, id);
  return { name: `${id}.wav`, samples, channels: clip(id).channels };
}

describe('describe from upstream’s vectors', () => {
  const models = fakeModels();
  it.each(['sfx-whoosh-fast-crisp', 'speech-01', 'music-120-fmaj', 'edge-pure-tone', 'texture-rain'])(
    '%s: the same tags, hints, AudioSet labels and character',
    async (id) => {
      type Tag = { term: string; category: string; z: number; cosine: number; verdict?: string };
      const theirs = cli<{
        top_tags: Tag[];
        music_hints: Tag[];
        audioset: { label: string; p: number }[];
        character: string[];
      }>('describe')[id]?.result;
      const ours = await describeSound(models, source(id));
      expect(ours.ok).toBe(true);
      if (!ours.ok || !theirs) return;
      expect(ours.value.tags.map((t) => [t.term, t.z, t.cosine])).toEqual(
        theirs.top_tags.map((t) => [t.term, t.z, t.cosine]),
      );
      expect(ours.value.tags.map((t) => t.verdict)).toEqual(
        theirs.top_tags.map((t) => (t.verdict === 'no match' ? 'no_match' : t.verdict)),
      );
      expect(ours.value.hints.map((t) => [t.term, t.z, t.verdict])).toEqual(
        theirs.music_hints.map((t) => [t.term, t.z, null]),
      );
      expect(ours.value.audioSet.map((a) => [a.label, a.score])).toEqual(
        theirs.audioset.map((a) => [a.label, a.p]),
      );
      expect(ours.value.character).toEqual(theirs.character);
    },
  );

  it('near silence and a few samples come back untagged', async () => {
    const quiet = await describeSound(models, { samples: new Float32Array(48_000).fill(1e-5) });
    expect(quiet.ok && [quiet.value.nearSilent, quiet.value.tags.length]).toEqual([true, 0]);
    const short = await describeSound(models, { samples: new Float32Array(100).fill(0.5) });
    expect(short.ok && [short.value.tooShort, short.value.tags.length]).toEqual([true, 0]);
    const late = await describeSound(models, { samples: new Float32Array(48_000) }, { range: { start: 2 } });
    expect(!late.ok && late.error.code).toBe('audio.listen_bad_input');
  });
});

describe('rank and compare from upstream’s vectors', () => {
  const models = fakeModels();
  it('rank: the same order, z and verdicts for every upstream query run', async () => {
    type Row = { name: string; z: number; verdict: string; sounds_most_like: string };
    for (const run of Object.values(cli<{ results: Row[] }>('rank'))) {
      const query = run.argv[1] ?? '';
      if (!text.queries.texts.includes(query)) continue;
      const files = run.argv.slice(2).filter((a) => a.endsWith('.wav'));
      const ours = await rankSounds(
        models,
        files.map((f) => source(f.replace(/\.wav$/, ''))),
        query,
      );
      expect(ours.ok).toBe(true);
      if (!ours.ok) continue;
      const theirs = run.result.results;
      expect(ours.value.results.slice(0, theirs.length).map((r) => [r.name, r.z])).toEqual(
        theirs.map((r) => [r.name, r.z]),
      );
      expect(ours.value.results[0]?.soundsMostLike.term).toBe(
        theirs[0]?.sounds_most_like.replace(/ \(z .*$/, ''),
      );
    }
  });

  it('compare: the same nearest references and typicality', async () => {
    type Run = { nearest: { name: string; cosine: number }[]; typicality: { z: number; percentile: number } };
    for (const [id, run] of Object.entries(cli<Run>('compare'))) {
      const refs = run.argv.slice(run.argv.indexOf('--refs') + 1).filter((a) => a.endsWith('.wav'));
      const ours = await compareSound(
        models,
        source(id),
        refs.map((f) => source(f.replace(/\.wav$/, ''))),
      );
      expect(ours.ok, id).toBe(true);
      if (!ours.ok) continue;
      expect(ours.value.nearest.map((n) => [refs[n.index], n.cosine])).toEqual(
        run.result.nearest.map((n) => [n.name, n.cosine]),
      );
      expect(ours.value.typicality.z).toBeCloseTo(run.result.typicality.z, 1);
      expect(ours.value.typicality.percentile).toBeCloseTo(run.result.typicality.percentile, 1);
    }
  });

  it('differences in words, as compare.py words them', () => {
    const a = { loudness_lufs: -20, brightness_hz: 2000, attack_ms: 5, decay_ms: 300, length_s: 0.5 };
    const b = { loudness_lufs: -14, brightness_hz: 3000, attack_ms: 5.5, decay_ms: 900, length_s: 0.5 };
    expect(differences(a, b)).toEqual({
      keys: ['loudness_lufs', 'brightness_hz', 'decay_ms'],
      words:
        '6 dB louder, brighter (brightness 3.0 kHz vs 2.0 kHz) and with a longer tail (900 ms vs 300 ms)',
    });
    expect(differences(a, a).keys).toEqual([]);
    expect(
      typicality(new Float32Array([1, 0]), [new Float32Array([1, 0]), new Float32Array([0, 1])], 5)
        .meanCosKnn,
    ).toBe(1);
  });
});
