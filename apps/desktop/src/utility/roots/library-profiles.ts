// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's ShotProfileSource in the agent process (P2-M2, packages/library
 * SPEC "Shot profiles for casting"): what vision stored on each shot, its
 * curves and peaks, place clusters, and its direction in the active
 * embedding space, for casting's catalogue (wired by the agent's timeline
 * tools). The space is the jobs process's, asked through main as soon as the
 * source is made and then at most every 30 s until it answers; until then
 * profiles have empty embeddings. Its index opens on this process's own
 * connection, which loads sqlite-vec (library-database.ts).
 */
import {
  ShotProfileSourceToken,
  type Container,
  type MainServicesClient,
  type VectorIndex,
} from '@taalcut/core';
import { createShotProfileSource, openVectorIndex, type LibraryDatabase } from '@taalcut/library';
import { AgentMainServicesToken, LibraryDatabaseToken } from '../../shared/tokens';

const SPACE_RETRY_MS = 30_000;

/** The active space's index on `db`, opened once main answers which space is active; null until then. */
export function activeSpaceIndex(
  db: LibraryDatabase,
  main: (() => MainServicesClient<'agent'>) | undefined,
  now: () => number = Date.now,
): () => VectorIndex | null {
  let index: VectorIndex | null = null;
  let asking = false;
  let lastTry = Number.NEGATIVE_INFINITY;
  const ask = () => {
    if (index || !main || asking || now() - lastTry < SPACE_RETRY_MS) return;
    asking = true;
    lastTry = now();
    void main()
      .embeddings.space()
      .then((space) => {
        const opened = openVectorIndex(db, { name: space.indexName, dimensions: space.dimensions });
        // No sqlite-vec in this connection: profiles go on without embeddings.
        if (opened.ok) index = opened.value;
      })
      // The jobs process doesn't serve the space yet: ask again later.
      .catch(() => undefined)
      .finally(() => {
        asking = false;
      });
  };
  ask();
  return () => {
    ask();
    return index;
  };
}

/** Unless casting registered the profiles on its own space (agent-casting.ts), which the agent root does first. */
export function registerLibraryProfiles(container: Container): void {
  if (container.has(ShotProfileSourceToken)) return;
  container.factory(
    ShotProfileSourceToken,
    ({ db }) => {
      const main = container.has(AgentMainServicesToken)
        ? container.resolve(AgentMainServicesToken)
        : undefined;
      return createShotProfileSource({ db, vectors: activeSpaceIndex(db, main) });
    },
    { deps: { db: LibraryDatabaseToken } },
  );
}
