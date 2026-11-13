// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G2: the SFX bank titles' text embeddings are made once a machine and kept in the derived cache. A "process"
 * here is a fresh set of listen sessions over a fake onnxruntime that counts the sessions it opens (no model files,
 * no GPU), with a fake CLAP text encoder that runs the text session once per phrase. A cache hit opens no text
 * session; the key moves with the bank version, the text build, its dtype and the config; a corrupt or mismatched
 * entry is a miss that is made again and written over; `searchSounds` after a restart embeds only the query.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DERIVED_KEY_PATTERN, err, ok, ValidationError } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DerivedJson } from '../../src/cleanup/speech-files';
import { createListenText } from '../../src/listen/calibrate/text';
import type { ListenModels } from '../../src/listen/describe/context';
import type { ClapTextEncoder } from '../../src/listen/models/clap-text';
import { LISTEN_COMPONENTS, type ListenModelFiles } from '../../src/listen/models/files';
import type { ListenOrt } from '../../src/listen/models/ort';
import { createListenSessions } from '../../src/listen/models/sessions';
import { bankTitlesQuery, searchSoundsQuery } from '../../src/listen/search/queries';
import {
  createTitleEmbeddings,
  titleCacheKey,
  type TitleSet,
  type TitleTextBuild,
} from '../../src/listen/search/title-cache';
import { bankCatalogue, bankItem, fitItem, writeCatalogue } from '../sfx-bank-helpers';

function unit(seed: number): Float32Array {
  const v = Float32Array.from({ length: 512 }, (_, i) => Math.sin(seed * 31 + i * 0.7));
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}
const seedOf = (text: string) => [...text].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);

function memoryJson(): DerivedJson & { store: Map<string, unknown>; reads: string[]; failWrites?: boolean } {
  const store = new Map<string, unknown>();
  const reads: string[] = [];
  const json = {
    store,
    reads,
    failWrites: false,
    read: async (key: string) => {
      reads.push(key);
      return (
        store.has(key) ? ok(store.get(key)) : { ok: false, error: { code: 'core.not_found' } }
      ) as never;
    },
    write: async (key: string, value: unknown) => {
      if (json.failWrites) return err(ValidationError({ field: 'key' }));
      store.set(key, JSON.parse(JSON.stringify(value)) as unknown);
      return ok(undefined);
    },
  };
  return json;
}

function filesOf(dtype: 'int8' | 'fp16', folder = 'build-1'): ListenModelFiles {
  const pick = async (name: keyof typeof LISTEN_COMPONENTS) => {
    const id = LISTEN_COMPONENTS[name] + (dtype === 'fp16' ? '-fp16' : '');
    return {
      name,
      componentId: id,
      dir: `/models/${id}/${folder}`,
      modelPath: `/models/${id}/model.onnx`,
      dtype,
    };
  };
  return { resolve: async (name) => ok(await pick(name)), installed: pick };
}

/** One app start: its own sessions (counting opens per model) and models over a shared derived cache. */
function startProcess(json: DerivedJson | undefined, dtype: 'int8' | 'fp16' = 'fp16', folder?: string) {
  const opened: string[] = [];
  const phrases: string[] = [];
  const ort: ListenOrt = {
    Tensor: class {
      constructor(
        readonly type: string,
        readonly data: unknown,
        readonly dims: readonly number[],
      ) {}
      dispose(): void {}
    } as unknown as ListenOrt['Tensor'],
    InferenceSession: {
      async create(model) {
        opened.push(typeof model === 'string' ? (model.split('/').at(-2) ?? '') : 'graph');
        return {
          outputNames: ['text_embeds'],
          run: async () => ({ text_embeds: { data: new Float32Array(512) } }),
          release: async () => undefined,
        };
      },
    },
  };
  const files = filesOf(dtype, folder);
  const sessions = createListenSessions({ files, loadModule: async () => ort });
  const encoder: ClapTextEncoder = {
    tokenize: async () => ok([0, 2]),
    embedRaw: async (texts) => ok(texts.map((t) => unit(seedOf(t)))),
    async embedPhrases(list, templates, signal) {
      for (const phrase of list) {
        phrases.push(phrase);
        const ran = await sessions.run(
          'clapText',
          { input_ids: { type: 'int64', data: new BigInt64Array([0n, 2n]), dims: [1, 2] } },
          signal,
        );
        if (!ran.ok) return ran;
      }
      return ok(list.map((phrase) => unit(seedOf(`${dtype}:${phrase}:${templates.length}`))));
    },
  };
  const text = createListenText({ sessions, files, encoder });
  const titles = createTitleEmbeddings({
    text,
    textModel: (signal) => sessions.model('clapText', signal),
    ...(json ? { json } : {}),
  });
  const models = { text, titles } as unknown as ListenModels;
  const textOpens = () => opened.filter((m) => m.startsWith(LISTEN_COMPONENTS.clapText)).length;
  return { models, titles, opened, phrases, textOpens };
}

const set: TitleSet = {
  set: 'sfx-bank',
  version: '0.4.0-ff41f07.1',
  titles: ['Whoosh fast, crisp', 'Tick domino', 'Boom deep'],
};
const build: TitleTextBuild = {
  componentId: 'clap-general-text-fp16',
  dir: '/c/installed/clap-general-text-fp16/16c8cc31-onnx-fp16-d78c3994-0123456789ab',
  dtype: 'fp16',
};

describe('the bank titles cache key', () => {
  it('is a listen/ derived key that moves with the bank version, text build, dtype, config and titles', () => {
    const key = titleCacheKey(set, build);
    expect(key).toMatch(DERIVED_KEY_PATTERN);
    expect(key).toMatch(/^listen\/[0-9a-f]{2}\/[0-9a-f]{64}\.titles\.[0-9a-f]{32}\.v1\.json$/);
    expect(titleCacheKey({ ...set }, { ...build })).toBe(key);
    const moved = [
      titleCacheKey({ ...set, version: '0.4.0-ff41f07.2' }, build),
      titleCacheKey(set, { ...build, componentId: 'clap-general-text', dtype: 'int8' }),
      titleCacheKey(set, { ...build, dtype: 'int8' }),
      titleCacheKey(set, { ...build, dir: build.dir.replace('d78c3994', 'e0000000') }),
      titleCacheKey({ ...set, titles: [...set.titles, 'Pop soft'] }, build),
    ];
    expect(new Set([key, ...moved]).size).toBe(moved.length + 1);
  });
});

describe('bank title embeddings', () => {
  it('are made once a machine: after a restart a hit opens no text session and runs nothing', async () => {
    const json = memoryJson();
    const first = startProcess(json);
    const made = await first.titles.embed(set);
    expect(made.ok).toBe(true);
    expect(first.textOpens()).toBe(1);
    expect(first.phrases).toEqual(expect.arrayContaining([...set.titles]));
    expect([...json.store.keys()]).toHaveLength(1);

    const restarted = startProcess(json);
    const hit = await restarted.titles.embed(set);
    expect(restarted.textOpens()).toBe(0);
    expect(restarted.opened).toEqual([]);
    expect(restarted.phrases).toEqual([]);
    expect(hit.ok && hit.value).toEqual(made.ok && made.value);
  });

  it('are kept in memory: a second ask in the same process reads nothing again', async () => {
    const json = memoryJson();
    const process = startProcess(json);
    await process.titles.embed(set);
    const reads = json.reads.length;
    const again = await process.titles.embed(set);
    expect(again.ok && again.value).toHaveLength(set.titles.length);
    expect(json.reads).toHaveLength(reads);
  });

  it('are made again for another dtype or bank version, never read across', async () => {
    const json = memoryJson();
    await startProcess(json, 'fp16').titles.embed(set);
    const int8 = startProcess(json, 'int8');
    const made = await int8.titles.embed(set);
    expect(int8.textOpens()).toBe(1);
    const newer = startProcess(json, 'fp16');
    await newer.titles.embed({ ...set, version: '0.4.1-ff41f07.1' });
    expect(newer.textOpens()).toBe(1);
    expect(json.store.size).toBe(3);
    // The int8 rows are the int8 build's, not the fp16 entry's.
    const fp16 = await startProcess(json, 'fp16').titles.embed(set);
    expect(made.ok && fp16.ok && made.value[0]).not.toEqual(fp16.ok && fp16.value[0]);
  });

  it.each([
    ['not JSON of an entry', () => 'garbage'],
    ['rows cut short', (e: Record<string, unknown>) => ({ ...e, rows: String(e.rows).slice(0, 100) })],
    [
      'a NaN row',
      (e: Record<string, unknown>) => ({ ...e, rows: Buffer.alloc(3 * 512 * 4, 0xff).toString('base64') }),
    ],
    ['another set of titles', (e: Record<string, unknown>) => ({ ...e, titles: 'f'.repeat(64) })],
    ['another text build', (e: Record<string, unknown>) => ({ ...e, textBuild: 'clap-general-text/x' })],
    ['another config', (e: Record<string, unknown>) => ({ ...e, config: 'ear1-0' })],
  ])('ignore a corrupt entry (%s), make it again and write it over', async (_label, corrupt) => {
    const json = memoryJson();
    const made = await startProcess(json).titles.embed(set);
    const [key] = [...json.store.keys()];
    if (!key) throw new Error('nothing cached');
    json.store.set(key, corrupt(json.store.get(key) as Record<string, unknown>));
    const restarted = startProcess(json);
    const again = await restarted.titles.embed(set);
    expect(restarted.textOpens()).toBe(1);
    expect(again.ok && again.value).toEqual(made.ok && made.value);
    // Rebuilt: the next start hits.
    const third = startProcess(json);
    await third.titles.embed(set);
    expect(third.textOpens()).toBe(0);
  });

  it('a cache that cannot be written still gives the rows, and a failed text model is tried again', async () => {
    const json = memoryJson();
    json.failWrites = true;
    const lines: string[] = [];
    const process = startProcess(undefined);
    const titles = createTitleEmbeddings({
      text: process.models.text,
      textModel: async () => ok(build),
      json,
      log: (line) => lines.push(line),
    });
    const made = await titles.embed(set);
    expect(made.ok && made.value).toHaveLength(3);
    expect(lines[0]).toMatch(/sfx-bank titles not cached/);
    let calls = 0;
    const failing = createTitleEmbeddings({
      text: {
        queries: async () => {
          calls += 1;
          return calls === 1 ? err(ValidationError({ field: 'x' })) : process.models.text.queries(set.titles);
        },
      },
      textModel: async () => ok(build),
    });
    expect((await failing.embed(set)).ok).toBe(false);
    expect((await failing.embed(set)).ok).toBe(true);
  });
});

describe('searchSounds over the bank after a restart', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-titles-'));
    const items = [bankItem(), fitItem()];
    await writeCatalogue(
      dir,
      bankCatalogue(items, {
        embeddings: [
          { model: 'clap-general-audio', dtype: 'fp16', file: 'embeddings-fp16.f32', dims: 512, rows: 2 },
        ],
      }),
    );
    const rows = Buffer.alloc(2 * 512 * 4);
    [unit(1), unit(2)].forEach((v, r) => v.forEach((x, i) => rows.writeFloatLE(x, (r * 512 + i) * 4)));
    await writeFile(join(dir, 'embeddings-fp16.f32'), rows);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const search = (models: ListenModels, family?: 'hit') =>
    searchSoundsQuery.run(
      { models, sources: [], audioDtype: 'fp16' },
      { query: 'a tick', bankDir: dir, ...(family ? { bankFamily: family } : {}) },
    );

  it('embeds only the query; the ranking is the same as the first start', async () => {
    const json = memoryJson();
    const first = startProcess(json);
    const cold = await search(first.models);
    expect(first.phrases).toEqual(expect.arrayContaining(['Whoosh fast, crisp', fitItem().title]));

    const restarted = startProcess(json);
    const warm = await search(restarted.models);
    expect(restarted.phrases).not.toContain('Whoosh fast, crisp');
    expect(restarted.phrases).not.toContain(fitItem().title);
    expect(restarted.phrases).toContain('a tick');
    if (!cold.ok || !warm.ok) throw new Error('search failed');
    expect(warm.value.hits).toEqual(cold.value.hits);
    expect(warm.value.hits.every((h) => h.nameScore !== null)).toBe(true);
  });

  it('a family search uses the whole set, so any later search hits', async () => {
    const json = memoryJson();
    const hits = await search(startProcess(json).models, 'hit');
    expect(hits.ok && hits.value.hits.map((h) => h.id)).toEqual(['fit/tick_domino']);
    const restarted = startProcess(json);
    await search(restarted.models);
    expect(restarted.phrases).not.toContain('Whoosh fast, crisp');
  });

  it('the bankTitles warm-up leaves nothing for the first search to make', async () => {
    const json = memoryJson();
    const warmed = await bankTitlesQuery.run(
      { models: startProcess(json).models, sources: [] },
      { bankDir: dir },
    );
    expect(warmed.ok && warmed.value).toEqual({ titles: 2 });
    const restarted = startProcess(json);
    await search(restarted.models);
    expect(restarted.phrases).toEqual(expect.not.arrayContaining(['Whoosh fast, crisp']));
  });

  it('without a title store (fakes, the evals) the titles are embedded as before', async () => {
    const process = startProcess(undefined);
    const bare = { text: process.models.text } as unknown as ListenModels;
    const found = await search(bare, 'hit');
    expect(found.ok && found.value.hits.map((h) => [h.id, h.nameScore])).toEqual([['fit/tick_domino', 0]]);
    expect(process.phrases).not.toContain('Whoosh fast, crisp');
  });
});
