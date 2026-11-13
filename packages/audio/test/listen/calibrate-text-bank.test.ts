// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F5 (D23): the text-embedding banks. The float16 format, the committed banks the CLAP audio components ship
 * (tools/components/listen/text-embeddings) against upstream's vocabulary embeddings, and `createListenText`: the
 * bank of the text dtype in use first, the text model only for what the bank lacks.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { blobRows } from '../../../../tools/earshot-parity/fixtures.mjs';
import { EVENT_VOCAB, listenPhraseSets, REALNESS_PROMPTS } from '../../src/listen/calibrate/phrase-sets';
import {
  decodeTextBank,
  encodeTextBank,
  fromHalf,
  textBankFiles,
  toHalf,
  type TextBankIndex,
} from '../../src/listen/calibrate/text-bank';
import { createListenText } from '../../src/listen/calibrate/text';
import { vocabTerms } from '../../src/listen/calibrate/vocab';
import type { ClapTextEncoder } from '../../src/listen/models/clap-text';
import type { ListenModelFiles, ResolvedListenModel } from '../../src/listen/models/files';
import type { ListenSessions } from '../../src/listen/models/sessions';
import { cosine } from './models-helpers';

const BANKS = new URL('../../../../tools/components/listen/text-embeddings/', import.meta.url);
const committed = (dtype: 'int8' | 'fp16') => {
  const files = textBankFiles(dtype);
  const index = JSON.parse(readFileSync(new URL(files.index, BANKS), 'utf8')) as TextBankIndex;
  const decoded = decodeTextBank(index, new Uint8Array(readFileSync(new URL(files.data, BANKS))));
  if (!decoded.ok) throw new Error(decoded.error.detail);
  return decoded.value;
};

describe('float16', () => {
  it('round-trips within half precision, with the edge values exact', () => {
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(-2)).toBe(0xc000);
    expect(toHalf(65504)).toBe(0x7bff);
    expect(toHalf(1e6)).toBe(0x7c00);
    expect(fromHalf(toHalf(2 ** -24))).toBe(2 ** -24);
    for (const v of [0.0441, -0.1234, 0.000123, 0.5])
      expect(Math.abs(fromHalf(toHalf(v)) - v)).toBeLessThan(Math.abs(v) * 1e-3);
  });
});

describe('the bank format', () => {
  const unit = (seed: number) => {
    const row = Float32Array.from({ length: 512 }, (_, i) => Math.sin(seed * 7 + i));
    const norm = Math.hypot(...row);
    return row.map((v) => v / norm);
  };
  const built = encodeTextBank({ model: 'm', textComponent: 'clap-general-text', dtype: 'int8' }, [
    { name: 'a', phrases: ['x', 'y'], templates: ['{}', 'the sound of {}'], rows: [unit(1), unit(2)] },
    { name: 'b', phrases: ['z'], templates: ['{}'], rows: [unit(3)] },
  ]);

  it('looks phrases up only with the templates they were embedded with', () => {
    const bank = decodeTextBank(built.index, built.data);
    expect(bank.ok).toBe(true);
    if (!bank.ok) return;
    const rows = bank.value.lookup(['y', 'x'], ['{}', 'the sound of {}']);
    expect(rows?.map((row, i) => cosine(row, unit(2 - i)))).toEqual([
      expect.closeTo(1, 6),
      expect.closeTo(1, 6),
    ]);
    expect(bank.value.lookup(['x'], ['{}'])).toBeUndefined();
    expect(bank.value.lookup(['x', 'missing'], ['{}', 'the sound of {}'])).toBeUndefined();
    expect(bank.value.lookup(['z'], ['{}'])).toHaveLength(1);
  });

  it('refuses data that does not match its sha256', () => {
    const bad = new Uint8Array(built.data);
    bad[10] = (bad[10] ?? 0) ^ 1;
    expect(decodeTextBank(built.index, bad).ok).toBe(false);
  });
});

describe('the committed banks', () => {
  it('hold the phrase sets the code asks for, realness’s prompts as vendored', () => {
    const vendored = JSON.parse(
      readFileSync(
        new URL('../../../../third_party/earshot/data/realness_model.json', import.meta.url),
        'utf8',
      ),
    ) as { prompts: { real: string[]; synth: string[] } };
    expect([...REALNESS_PROMPTS]).toEqual([...vendored.prompts.real, ...vendored.prompts.synth]);
    expect(Object.values(EVENT_VOCAB).flat()).toHaveLength(49);
    for (const dtype of ['int8', 'fp16'] as const) {
      const bank = committed(dtype);
      expect(bank.dtype).toBe(dtype);
      expect(bank.sets.map(({ name, phrases, templates }) => ({ name, phrases, templates }))).toEqual(
        listenPhraseSets().map(({ name, phrases, templates }) => ({ name, phrases, templates })),
      );
      expect(bank.sets[0]?.categories).toEqual(vocabTerms().categories);
    }
  });

  it('are the text model’s vocabulary: fp16 cosine ≥ 0.9999 to upstream, int8 ≥ 0.98', () => {
    const theirs = blobRows('clap-text/vocab');
    for (const [dtype, floor] of [
      ['fp16', 0.9999],
      ['int8', 0.98],
    ] as const) {
      const rows = committed(dtype).lookup(vocabTerms().terms, vocabTerms().templates) ?? [];
      const worst = Math.min(...rows.map((row, i) => cosine(row, theirs[i] ?? [])));
      console.warn(`text bank ${dtype}: vocabulary min cosine to upstream ${worst.toFixed(5)}`);
      expect(rows).toHaveLength(322);
      expect(worst).toBeGreaterThanOrEqual(floor);
    }
  });
});

describe('createListenText', () => {
  async function audioDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'listen-text-'));
    for (const dtype of ['int8', 'fp16'] as const) {
      const files = textBankFiles(dtype);
      await writeFile(join(dir, files.index), readFileSync(new URL(files.index, BANKS)));
      await writeFile(join(dir, files.data), readFileSync(new URL(files.data, BANKS)));
    }
    return dir;
  }

  function setup(dir: string, text?: 'int8' | 'fp16') {
    const resolved: string[] = [];
    const embedded: string[][] = [];
    const model = (name: ResolvedListenModel['name'], dtype: 'int8' | 'fp16'): ResolvedListenModel => ({
      name,
      componentId: name,
      dir,
      modelPath: join(dir, 'model.onnx'),
      dtype,
    });
    const sessions = {
      async model(name: ResolvedListenModel['name']) {
        resolved.push(name);
        return ok(model(name, name === 'clapText' ? (text ?? 'fp16') : 'fp16'));
      },
    } as unknown as ListenSessions;
    const files: ListenModelFiles = {
      resolve: async (name) => ok(model(name, 'fp16')),
      installed: async (name) => (name === 'clapText' && text ? model(name, text) : undefined),
    };
    const encoder = {
      async embedPhrases(phrases: readonly string[]) {
        embedded.push([...phrases]);
        return ok(phrases.map(() => new Float32Array(512).fill(1 / Math.sqrt(512))));
      },
    } as unknown as ClapTextEncoder;
    return { listen: createListenText({ sessions, files, encoder }), resolved, embedded };
  }

  it('describes from the bank: the vocabulary loads no text model', async () => {
    const { listen, resolved, embedded } = setup(await audioDir());
    const vocab = await listen.vocab();
    expect(vocab.ok && vocab.value.rows).toHaveLength(322);
    expect(resolved).not.toContain('clapText');
    expect(embedded).toEqual([]);
  });

  it('free text goes to the text model, and the vocabulary follows its dtype', async () => {
    const { listen, embedded } = setup(await audioDir(), 'int8');
    const queries = await listen.queries(['a very particular squeak of a rubber duck']);
    expect(queries.ok).toBe(true);
    expect(embedded).toEqual([['a very particular squeak of a rubber duck']]);
    const vocab = queries.ok ? queries.value.vocab : undefined;
    const int8 = committed('int8').lookup(vocabTerms().terms, vocabTerms().templates);
    expect(vocab?.rows[0]).toEqual(int8?.[0]);
  });

  it('a fixed phrase (an event tag, a realness prompt) comes from the bank', async () => {
    const { listen, embedded } = setup(await audioDir());
    const prompts = await listen.embed([...REALNESS_PROMPTS], ['{}']);
    expect(prompts.ok && prompts.value.fromBank).toBe(true);
    expect(embedded).toEqual([]);
  });

  it('D23: on an int8 machine tags still use the fp16-built bank, free text the int8 one', async () => {
    const { listen, embedded } = setup(await audioDir(), 'int8');
    const terms = vocabTerms();
    const fp16 = committed('fp16').lookup(terms.terms, terms.templates);
    const int8 = committed('int8').lookup(terms.terms, terms.templates);
    const tags = await listen.vocab();
    expect(tags.ok && tags.value.rows[0]).toEqual(fp16?.[0]);
    const prompts = await listen.embed([...REALNESS_PROMPTS], ['{}']);
    expect(prompts.ok && prompts.value.dtype).toBe('fp16');
    const queries = await listen.queries(['a fast whoosh']);
    expect(queries.ok && queries.value.vocab.rows[0]).toEqual(int8?.[0]);
    expect(queries.ok && queries.value.queries[0]?.embedding).toEqual(
      int8?.[vocabTerms().terms.indexOf('a fast whoosh')],
    );
    expect(embedded).toEqual([]);
  });
});
