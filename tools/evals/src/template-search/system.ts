// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The real template search for the eval (LRN1-TPL): the library's TemplateSearch (template_fts words, the template
 * index's document and slot-intent vectors, fused as TEMPLATE_SEARCH_V1) over the library's template store, with the
 * index written by @taalcut/templates (world.ts). The embedder is EmbeddingGemma 2 (the app's) when given a model
 * folder, else the casting eval's deterministic stand-in, whose space the fusion's similarity floors don't apply to.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap, type Embedder, type TemplateSearch } from '@taalcut/core';
import { createTemplateSearch } from '@taalcut/library';
import { loadTemplateLibrary } from '../template-fit/library';
import { openTemplateWorld, type TemplateWorld } from '../template-fit/world';
import type { TemplateQuery, TemplateSearchPrediction } from './schema';

export interface TemplateSearchSystem {
  search(query: Pick<TemplateQuery, 'queryId' | 'library' | 'text'>): Promise<TemplateSearchPrediction>;
  close(): Promise<void>;
}

export interface TemplateSearchOptions {
  /** Library name (its templates.json `library`) → its folder. */
  readonly libraries: Readonly<Record<string, string>>;
  readonly embedder: Embedder;
  /** An empty folder for each library's database. */
  readonly workDir: string;
}

/** Results read per query: enough for hit@5, nDCG@5 and the reciprocal rank of a hit further down. */
const RESULTS = 20;

interface Loaded {
  readonly world: TemplateWorld;
  readonly search: TemplateSearch;
}

async function load(name: string, dir: string, options: TemplateSearchOptions): Promise<Loaded> {
  const library = loadTemplateLibrary(dir);
  const workDir = join(options.workDir, name);
  mkdirSync(workDir, { recursive: true });
  const world = await openTemplateWorld({
    dir: workDir,
    embedder: options.embedder,
    templates: library.templates,
  });
  const search = createTemplateSearch({ db: world.db, vectors: world.index, embedder: options.embedder });
  return { world, search };
}

export function templateSearchSystem(options: TemplateSearchOptions): TemplateSearchSystem {
  const loaded = new Map<string, Promise<Loaded>>();
  const library = (name: string) => {
    const found = loaded.get(name);
    if (found) return found;
    const dir = options.libraries[name];
    if (dir === undefined) throw new Error(`No folder for template library ${name}: pass --library`);
    const loading = load(name, dir, options);
    loaded.set(name, loading);
    return loading;
  };

  return {
    async search(query) {
      const { world, search } = await library(query.library);
      const found = unwrap(
        await search.search({
          text: query.text,
          includeUnlisted: false,
          includeArchived: false,
          limit: RESULTS,
        }),
      );
      return {
        queryId: query.queryId,
        library: query.library,
        results: found.hits.map((hit) => world.keyOf.get(hit.summary.id) ?? hit.summary.id),
        degraded: found.degraded,
        fusion: found.fusion,
        space: options.embedder.space.indexName,
      };
    },
    async close() {
      // A library that failed to load has already failed the query that asked for it.
      const settled = await Promise.allSettled(loaded.values());
      for (const item of settled) if (item.status === 'fulfilled') item.value.world.close();
    },
  };
}
