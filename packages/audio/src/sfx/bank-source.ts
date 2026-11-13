// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The installed `sfx-bank` component (EAR1-D2): its catalogue read and validated once per folder, the items listed
 * or filtered (by family, kit role, bank source, licence or id), a take's file, and the CLAP embeddings
 * `sfx.searchSounds` ranks (lane B): one row per item, in `items` order. A missing folder, catalogue or embedding
 * file is `audio.sfx_bank_missing`; nothing here decodes audio.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type AsyncResult, type BundledLicence, type SfxCategory } from '@taalcut/core';
import { SfxBankMissing } from '../listen/errors';
import {
  SFX_BANK_EMBEDDING_DIMS,
  sfxBankCatalogueSchema,
  type SfxBankCatalogue,
  type SfxBankEmbeddingDtype,
  type SfxBankItem,
  type SfxBankSourceName,
  type SfxBankTake,
} from './bank-catalogue';

/** Every given filter must match; an empty query lists the whole bank. */
export interface SfxBankQuery {
  readonly family?: SfxCategory;
  /** A kit role or cue kind: 'whoosh' finds whoosh.short and whoosh.long, 'whoosh.long' only those. */
  readonly kind?: string;
  readonly source?: SfxBankSourceName;
  readonly licence?: BundledLicence;
  /** earshot's category ('whoosh_fast', 'cut_hit', 'fit'). */
  readonly category?: string;
  readonly ids?: readonly string[];
}

export interface SfxBankEmbeddings {
  readonly dtype: SfxBankEmbeddingDtype;
  readonly dims: number;
  /** Row-major, `items.length` × `dims`, unit rows; row i is items[i]'s first take. */
  readonly rows: Float32Array;
}

export interface SfxBank {
  readonly catalogue: SfxBankCatalogue;
  readonly items: readonly SfxBankItem[];
  item(id: string): SfxBankItem | undefined;
  /** Taalcut's id for an earshot id ('fit/land.light/fingertip_book'), or the id itself. */
  byUpstreamId(upstreamId: string): SfxBankItem | undefined;
  filter(query: SfxBankQuery): SfxBankItem[];
  pathOf(take: SfxBankTake): string;
  /** The dtypes the bank has embeddings for (none until the build's embedding step ran). */
  embeddingDtypes(): readonly SfxBankEmbeddingDtype[];
  /** The embeddings computed with `dtype`'s CLAP build (F4's runner), read once. */
  embeddings(dtype: SfxBankEmbeddingDtype): AsyncResult<SfxBankEmbeddings>;
}

export interface SfxBankSource {
  load(): AsyncResult<SfxBank>;
}

const kindMatches = (kinds: readonly string[], kind: string) =>
  kinds.some((k) => k === kind || k.split('.')[0] === kind);

export function sfxBankOf(catalogue: SfxBankCatalogue, dir: string): SfxBank {
  const byId = new Map(catalogue.items.map((item) => [item.id, item]));
  const byUpstream = new Map(catalogue.items.map((item) => [item.upstreamId, item]));
  const loaded = new Map<SfxBankEmbeddingDtype, Promise<Awaited<AsyncResult<SfxBankEmbeddings>>>>();

  async function readEmbeddings(dtype: SfxBankEmbeddingDtype): AsyncResult<SfxBankEmbeddings> {
    const set = catalogue.embeddings.find((s) => s.dtype === dtype);
    if (!set) return err(SfxBankMissing(undefined, { detail: `the bank has no ${dtype} embeddings` }));
    let bytes: Buffer;
    try {
      bytes = await readFile(join(dir, set.file));
    } catch {
      return err(SfxBankMissing(undefined, { detail: `no ${set.file} in the sfx-bank component` }));
    }
    if (bytes.length !== set.rows * set.dims * 4)
      return err(SfxBankMissing(undefined, { detail: `${set.file} is ${bytes.length} bytes` }));
    const rows = new Float32Array(set.rows * set.dims);
    for (let i = 0; i < rows.length; i++) rows[i] = bytes.readFloatLE(i * 4);
    return ok({ dtype, dims: SFX_BANK_EMBEDDING_DIMS, rows });
  }

  return {
    catalogue,
    items: catalogue.items,
    item: (id) => byId.get(id),
    byUpstreamId: (id) => byUpstream.get(id) ?? byId.get(id),
    filter(query) {
      const ids = query.ids ? new Set(query.ids) : null;
      return catalogue.items.filter(
        (item) =>
          (!query.family || item.family === query.family) &&
          (!query.kind || kindMatches(item.kinds, query.kind)) &&
          (!query.source || item.source === query.source) &&
          (!query.licence || item.licence === query.licence) &&
          (!query.category || item.category === query.category) &&
          (!ids || ids.has(item.id)),
      );
    },
    pathOf: (take) => join(dir, take.file),
    embeddingDtypes: () => catalogue.embeddings.map((s) => s.dtype),
    embeddings(dtype) {
      let pending = loaded.get(dtype);
      if (!pending) {
        pending = readEmbeddings(dtype);
        loaded.set(dtype, pending);
      }
      return pending;
    },
  };
}

/** The catalogue in `dir`, validated; `audio.sfx_bank_missing` when it is absent or not the shape it should be. */
export async function loadSfxBank(dir: string): AsyncResult<SfxBank> {
  let raw: string;
  try {
    raw = await readFile(join(dir, 'catalogue.json'), 'utf8');
  } catch {
    return err(SfxBankMissing(undefined, { detail: 'no catalogue.json in the sfx-bank component' }));
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err(SfxBankMissing(undefined, { detail: 'catalogue.json is not JSON' }));
  }
  const parsed = sfxBankCatalogueSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(
      SfxBankMissing(undefined, {
        detail: `bad catalogue at ${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}`.slice(
          0,
          300,
        ),
      }),
    );
  }
  return ok(sfxBankOf(parsed.data, dir));
}

/**
 * The bank wherever `dir()` says it is installed now (the desktop: the component manager's folder), read once per
 * folder: a bank installed later is found, an unchanged one isn't parsed again.
 */
export function sfxBankSource(dir: () => string | null | undefined): SfxBankSource {
  let cached: { dir: string; bank: SfxBank } | undefined;
  return {
    async load() {
      const at = dir();
      if (!at) return err(SfxBankMissing(undefined, { detail: 'component sfx-bank is not installed' }));
      if (cached?.dir === at) return ok(cached.bank);
      const loaded = await loadSfxBank(at);
      if (loaded.ok) cached = { dir: at, bank: loaded.value };
      return loaded;
    },
  };
}
