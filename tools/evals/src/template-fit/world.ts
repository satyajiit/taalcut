// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app's template side for the template evals and the fit bench (LRN1-TPL): a library database with sqlite-vec,
 * the library's template store, the template index named as the app names it (templateIndexName of the embedder's
 * space) and @taalcut/templates' writer, caught up once like the agent's start does. Only the embedder is the eval's:
 * a deterministic stand-in, or EmbeddingGemma 2 for a real run.
 */
import { join } from 'node:path';
import {
  templateIndexName,
  unwrap,
  type Embedder,
  type Template,
  type TemplateId,
  type TemplateStore,
  type VectorIndex,
} from '@taalcut/core';
import {
  createTemplateStore,
  openDatabase,
  openVectorIndex,
  sqliteVecPath,
  type LibraryDatabase,
} from '@taalcut/library';
import { createTemplateVectors, type TemplateVectors, type TemplateVectorSync } from '@taalcut/templates';

export interface WorldTemplate {
  /** The eval's name for it (its file in the library folder). */
  readonly key: string;
  readonly template: Template;
  /** The name it is saved under: words the search's word list reads. */
  readonly name: string;
  readonly tags?: readonly string[];
}

export interface TemplateWorld {
  readonly db: LibraryDatabase;
  readonly store: TemplateStore;
  readonly index: VectorIndex;
  readonly vectors: TemplateVectors;
  /** What the first catch-up wrote (every template's vectors). */
  readonly caughtUp: TemplateVectorSync;
  readonly keyOf: ReadonlyMap<TemplateId, string>;
  readonly idOf: ReadonlyMap<string, TemplateId>;
  close(): void;
}

export interface TemplateWorldOptions {
  /** A folder for the database and the template assets. */
  readonly dir: string;
  readonly embedder: Embedder;
  readonly templates: readonly WorldTemplate[];
}

export async function openTemplateWorld(options: TemplateWorldOptions): Promise<TemplateWorld> {
  const db = unwrap(openDatabase({ path: join(options.dir, 'library.db'), extensions: [sqliteVecPath()] }));
  const store = createTemplateStore(db, { assetsDir: join(options.dir, 'template-assets') });
  const keyOf = new Map<TemplateId, string>();
  const idOf = new Map<string, TemplateId>();
  for (const item of options.templates) {
    const created = unwrap(
      await store.create(item.template, { name: item.name, projectId: null, listed: true }),
    );
    if (item.tags && item.tags.length > 0) unwrap(await store.setMeta(created.id, { tags: [...item.tags] }));
    keyOf.set(created.id, item.key);
    idOf.set(item.key, created.id);
  }
  const { space } = options.embedder;
  const index = unwrap(
    openVectorIndex(db, { name: templateIndexName(space.indexName), dimensions: space.dimensions }),
  );
  const vectors = createTemplateVectors({ index, embedder: options.embedder, store });
  const caughtUp = unwrap(await vectors.reconcile());
  return { db, store, index, vectors, caughtUp, keyOf, idOf, close: () => db.close() };
}
