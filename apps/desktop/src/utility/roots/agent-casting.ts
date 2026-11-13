// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Casting in the agent process (P2-M2): the library's shot profiles and the
 * active embedding space's vectors (vectorShotCatalog), and slot intents
 * embedded by the jobs process's model through main. The space is asked for
 * at the first cast and again at most every 30 s until the jobs process
 * answers, as library search does; until then a cast fails plainly with
 * vision.embedder_unavailable instead of casting blind.
 */
import {
  createToken,
  embedderOverRpc,
  err,
  ShotProfileSourceToken,
  type Container,
  type Embedder,
  type EmbeddingSpace,
  type ShotProfileSource,
  type VectorIndex,
} from '@taalcut/core';
import { createShotProfileSource, openVectorIndex } from '@taalcut/library';
import {
  createCastingEngine,
  vectorShotCatalog,
  type CastingEngine,
  type ShotCatalog,
} from '@taalcut/timeline';
import { EmbedderUnavailable, EMBEDDING_SPACE } from '@taalcut/vision';
import { AgentMainServicesToken, LibraryDatabaseToken } from '../../shared/tokens';
import { CastingConfigSourceToken } from './agent-casting-prefs';

export const CastingEngineToken = createToken<CastingEngine>('desktop.castingEngine');
export const ShotCatalogToken = createToken<ShotCatalog>('desktop.shotCatalog');

const SPACE_RETRY_MS = 30_000;

interface ActiveSpace {
  readonly index: VectorIndex;
  readonly embedder: Embedder;
}

/** The active space's index and query embedder, once the jobs process serves them. */
function lazySpace(container: Container) {
  let active: ActiveSpace | undefined;
  let lastTry = Number.NEGATIVE_INFINITY;
  let pending: Promise<ActiveSpace | undefined> | undefined;

  async function open(): Promise<ActiveSpace | undefined> {
    if (!container.has(AgentMainServicesToken)) return undefined;
    const main = container.resolve(AgentMainServicesToken);
    try {
      const space: EmbeddingSpace = await main().embeddings.space();
      const index = openVectorIndex(container.resolve(LibraryDatabaseToken), {
        name: space.indexName,
        dimensions: space.dimensions,
      });
      if (!index.ok) return undefined;
      return { index: index.value, embedder: embedderOverRpc(() => main().embeddings, space) };
    } catch {
      // The embedding model isn't served yet (vision, P2-L9).
      return undefined;
    }
  }

  return {
    async current(): Promise<ActiveSpace | undefined> {
      if (active || Date.now() - lastTry < SPACE_RETRY_MS) return active;
      lastTry = Date.now();
      pending ??= open().finally(() => (pending = undefined));
      active = await pending;
      return active;
    },
    /** Whatever is open now, for profiles' vectors (sync). */
    index: (): VectorIndex | null => active?.index ?? null,
  };
}

/** The same lazily opened space for the template index (agent-template-index.ts, LRN1-TPL). */
export { lazySpace as lazyEmbeddingSpace };

const unavailable = () =>
  err(EmbedderUnavailable(undefined, { detail: 'the jobs process does not serve an embedding space yet' }));

/**
 * vectorShotCatalog once the space is open. The profile reads ask for the space first too, and go on without vectors
 * only when it isn't served. FIX-KILL: a cast reads the newest shots (its hook's novelty) before it embeds its
 * intents, which used to open the space; so a process's first cast scored novelty against no vectors and every later
 * cast against real ones, and the same ask cast differently depending on whether a cast came before it.
 */
function lazyCatalog(space: ReturnType<typeof lazySpace>, profiles: ShotProfileSource): ShotCatalog {
  let catalog: { index: VectorIndex; catalog: ShotCatalog } | undefined;
  return {
    async nearest(query, filter, k, signal) {
      const current = await space.current();
      if (!current) return unavailable();
      if (catalog?.index !== current.index)
        catalog = { index: current.index, catalog: vectorShotCatalog({ index: current.index, profiles }) };
      return catalog.catalog.nearest(query, filter, k, signal);
    },
    async list(filter, limit, signal) {
      await space.current();
      return profiles.list(filter, limit, signal);
    },
    async profiles(refs, signal) {
      await space.current();
      return profiles.profiles(refs, signal);
    },
    async recent(limit, signal) {
      await space.current();
      return profiles.recent(limit, signal);
    },
  };
}

function lazyEmbedder(space: ReturnType<typeof lazySpace>): Embedder {
  let known: EmbeddingSpace = EMBEDDING_SPACE;
  return {
    get space() {
      return known;
    },
    async embedTexts(texts, options) {
      const current = await space.current();
      if (!current) return unavailable();
      known = current.embedder.space;
      return current.embedder.embedTexts(texts, options);
    },
  };
}

/**
 * The shot profiles (unless another root registered them first), the catalogue and the casting engine. The
 * profiles' vectors come from the space the catalogue awaits, so a cast never reads profiles before it is open.
 */
export function registerCasting(container: Container): void {
  const space = lazySpace(container);
  if (!container.has(ShotProfileSourceToken))
    container.factory(
      ShotProfileSourceToken,
      ({ db }) => createShotProfileSource({ db, vectors: () => space.index() }),
      { deps: { db: LibraryDatabaseToken } },
    );
  container.factory(ShotCatalogToken, ({ profiles }) => lazyCatalog(space, profiles), {
    deps: { profiles: ShotProfileSourceToken },
  });
  container.factory(
    CastingEngineToken,
    ({ catalog, configSource }) =>
      createCastingEngine({ catalog, embedder: lazyEmbedder(space), configSource }),
    // LRN1-PREF: every call resolves its config, the learned weights included (agent-casting-prefs.ts).
    { deps: { catalog: ShotCatalogToken, configSource: CastingConfigSourceToken } },
  );
}
