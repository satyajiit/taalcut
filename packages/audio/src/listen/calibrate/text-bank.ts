// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text embeddings computed at build time (EAR1-F5, D23), one bank per text dtype, shipped in both
 * `clap-general-audio` builds so describe, sections and the fixed phrase sets need no text model download:
 * `listen-text-<dtype>.json` (the index: model, dtype, and each set's phrases, categories and templates with their
 * hash) beside `listen-text-<dtype>.f16` (float16 little-endian rows of 512, sets one after another). A unit row in
 * float16 is within 2e-4 of float32 per component, about 1e-5 in cosine.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import { LISTEN_CONFIG, type ListenDtype } from '../config';
import { ListenFailed } from '../errors';

const DIM = LISTEN_CONFIG.clap.embedDim;

export interface TextBankSet {
  readonly name: string;
  readonly templates: readonly string[];
  readonly phrases: readonly string[];
  /** The vocabulary's categories, one per phrase (the `vocab` set only). */
  readonly categories?: readonly string[];
  readonly rows: readonly Float32Array[];
}

export interface TextBank {
  readonly model: string;
  readonly dtype: ListenDtype;
  readonly sets: readonly TextBankSet[];
  /** Every phrase's row when each was embedded with exactly these templates; undefined otherwise. */
  lookup(phrases: readonly string[], templates: readonly string[]): Float32Array[] | undefined;
}

interface IndexSet {
  readonly name: string;
  readonly templates: readonly string[];
  readonly templatesSha256: string;
  readonly phrases: readonly string[];
  readonly categories?: readonly string[];
  readonly offset: number;
}

export interface TextBankIndex {
  readonly format: 1;
  readonly encoding: 'float16le';
  readonly dim: number;
  readonly model: string;
  readonly textComponent: string;
  readonly dtype: ListenDtype;
  readonly data: string;
  readonly sha256: string;
  readonly sets: readonly IndexSet[];
}

export const textBankFiles = (dtype: ListenDtype) => ({
  index: `listen-text-${dtype}.json`,
  data: `listen-text-${dtype}.f16`,
});

export const templatesHash = (templates: readonly string[]): string =>
  createHash('sha256').update(JSON.stringify(templates)).digest('hex');

/** IEEE half from a float, round to nearest even. */
export function toHalf(value: number): number {
  const f32 = new Float32Array([value]);
  const bits = new Uint32Array(f32.buffer)[0] ?? 0;
  const sign = (bits >>> 16) & 0x8000;
  const exp = (bits >>> 23) & 0xff;
  let mant = bits & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    const half = mant >>> shift;
    const rest = mant & ((1 << shift) - 1);
    const mid = 1 << (shift - 1);
    return sign | (rest > mid || (rest === mid && (half & 1) === 1) ? half + 1 : half);
  }
  const rest = mant & 0x1fff;
  let half = (e << 10) | (mant >>> 13);
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1) === 1)) half += 1;
  return sign | half;
}

export function fromHalf(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >>> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

/** The index and the float16 bytes for `sets` (build time). */
export function encodeTextBank(
  meta: { readonly model: string; readonly textComponent: string; readonly dtype: ListenDtype },
  sets: readonly TextBankSet[],
): { index: TextBankIndex; data: Uint8Array } {
  const total = sets.reduce((sum, set) => sum + set.rows.length, 0);
  const data = new Uint8Array(total * DIM * 2);
  const view = new DataView(data.buffer);
  let offset = 0;
  const indexSets: IndexSet[] = sets.map((set) => {
    const at = offset;
    for (const row of set.rows) {
      for (let i = 0; i < DIM; i++) view.setUint16((offset * DIM + i) * 2, toHalf(row[i] ?? 0), true);
      offset += 1;
    }
    return {
      name: set.name,
      templates: set.templates,
      templatesSha256: templatesHash(set.templates),
      phrases: set.phrases,
      ...(set.categories ? { categories: set.categories } : {}),
      offset: at,
    };
  });
  const sha256 = createHash('sha256').update(data).digest('hex');
  const files = textBankFiles(meta.dtype);
  return {
    index: { format: 1, encoding: 'float16le', dim: DIM, ...meta, data: files.data, sha256, sets: indexSets },
    data,
  };
}

function bank(index: TextBankIndex, sets: TextBankSet[]): TextBank {
  const byKey = new Map<string, Float32Array>();
  for (const set of sets) {
    const hash = templatesHash(set.templates);
    set.phrases.forEach((phrase, i) => {
      const row = set.rows[i];
      if (row) byKey.set(`${hash}\u0000${phrase}`, row);
    });
  }
  return {
    model: index.model,
    dtype: index.dtype,
    sets,
    lookup(phrases, templates) {
      const hash = templatesHash(templates);
      const out: Float32Array[] = [];
      for (const phrase of phrases) {
        const row = byKey.get(`${hash}\u0000${phrase}`);
        if (!row) return undefined;
        out.push(row);
      }
      return out;
    },
  };
}

export function decodeTextBank(index: TextBankIndex, data: Uint8Array): Result<TextBank> {
  const bad = (detail: string) => err(ListenFailed(undefined, { detail: `text bank: ${detail}` }));
  if (index.format !== 1 || index.encoding !== 'float16le' || index.dim !== DIM) return bad('unknown format');
  if (createHash('sha256').update(data).digest('hex') !== index.sha256)
    return bad('data does not match its sha256');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const rowCount = data.byteLength / (DIM * 2);
  const sets: TextBankSet[] = [];
  for (const set of index.sets) {
    if (set.offset + set.phrases.length > rowCount) return bad(`set ${set.name} runs past the data`);
    if (templatesHash(set.templates) !== set.templatesSha256) return bad(`set ${set.name}: templates hash`);
    const rows = set.phrases.map((_, r) =>
      Float32Array.from({ length: DIM }, (__, i) =>
        fromHalf(view.getUint16(((set.offset + r) * DIM + i) * 2, true)),
      ),
    );
    sets.push({
      name: set.name,
      templates: set.templates,
      phrases: set.phrases,
      ...(set.categories ? { categories: set.categories } : {}),
      rows,
    });
  }
  return ok(bank(index, sets));
}

/** The bank for `dtype` in a component folder; undefined when that build ships none. */
export async function readTextBank(dir: string, dtype: ListenDtype): AsyncResult<TextBank | undefined> {
  const files = textBankFiles(dtype);
  let index: TextBankIndex;
  try {
    index = JSON.parse(await readFile(join(dir, files.index), 'utf8')) as TextBankIndex;
  } catch {
    return ok(undefined);
  }
  try {
    const data = await readFile(join(dir, index.data));
    return decodeTextBank(index, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unreadable';
    return err(ListenFailed(undefined, { detail: `text bank: ${detail}`.slice(0, 500) }));
  }
}
